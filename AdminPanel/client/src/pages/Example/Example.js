import {useState, useEffect, useRef, useCallback} from 'react';
import {generateDocServerToken} from '../../api';

/**
 * Preview page component with ONLYOFFICE Document Editor
 * @param {Object} props - Component props
 * @returns {JSX.Element} Preview component
 */
function Preview(props) {
  const {user} = props;

  const [editorConfig, setEditorConfig] = useState(null);
  const editorRef = useRef(null);

  /**
   * Initialize the ONLYOFFICE editor
   */
  const initEditor = useCallback(async () => {
    const userName = user?.email?.split('@')[0] || 'admin';

    const document = {
      fileType: 'docx',
      key: '0' + Math.random(),
      title: 'Example Document',
      url: `${window.location.origin}/${window.location.pathname.split('/')[1].includes('example') ? '' : window.location.pathname.split('/')[1] + '/'}assets/sample.docx`,
      permissions: {
        edit: true,
        review: true,
        comment: true,
        copy: true,
        print: true,
        chat: true,
        fillForms: true
      }
    };

    const editorConfig = {
      user: {
        id: userName,
        name: userName
      },
      lang: navigator.language || navigator.userLanguage || 'en',
      mode: 'edit'
    };

    try {
      const config = {
        document,
        documentType: 'word',
        editorConfig,
        height: '100%',
        width: '100%'
      };
      const {token} = await generateDocServerToken(config);
      config.token = token;

      if (
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini|Macintosh/i.test(navigator.userAgent) &&
        navigator.maxTouchPoints &&
        navigator.maxTouchPoints > 1
      ) {
        config.type = 'mobile';
      }

      setEditorConfig(config);
    } catch (error) {
      console.error('Failed to load editor:', error);
    }
  }, [user]);

  useEffect(() => {
    // Load ONLYOFFICE API script
    const script = document.createElement('script');
    const url = process.env.REACT_APP_DOCSERVICE_URL
      ? `${process.env.REACT_APP_DOCSERVICE_URL}/web-apps/apps/api/documents/api.js`
      : '../web-apps/apps/api/documents/api.js';
    script.src = url;
    script.async = true;
    script.onload = () => {
      initEditor();
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup
      if (window.docEditor) {
        try {
          window.docEditor.destroyEditor();
        } catch (e) {
          console.warn('Editor cleanup error:', e);
        }
      }
      window.DocsAPI = undefined;
      document.head.removeChild(script);
    };
  }, [initEditor]);

  useEffect(() => {
    if (editorConfig && window.DocsAPI && editorRef.current) {
      try {
        window.docEditor = new window.DocsAPI.DocEditor('onlyoffice-editor', editorConfig);
      } catch (error) {
        console.error('Error initializing editor:', error);
      }
    }
  }, [editorConfig]);

  return (
    <div style={{height: '100%', margin: 0}}>
      <div id='onlyoffice-editor' ref={editorRef} style={{height: '100%', width: '100%'}} />
    </div>
  );
}

export default Preview;
