import {useState, useEffect, useRef, useCallback} from 'react';
import {generateDocServerToken} from '../../api';
import {getBasename, getDocServicePath} from '../../utils/paths';

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
    let url = `${getBasename()}/assets/sample.docx`;

    // Add origin only if URL is not absolute (doesn't start with http:// or https://)
    if (!/^https?:\/\//i.test(url)) {
      url = window.location.origin + url;
    }

    const document = {
      fileType: 'docx',
      key: '0' + Math.random(),
      title: 'Example Document',
      url,
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

      const userAgent = navigator.userAgent;
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i.test(userAgent);
      // iPadOS 13+ often requests desktop site (Macintosh UA) but has touch
      const isIPad = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
      const isTouchDevice = isMobileUA || isIPad || window.matchMedia?.('(pointer: coarse)').matches;

      if (isTouchDevice) {
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
    script.src = `${getDocServicePath()}/web-apps/apps/api/documents/api.js`;
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
