import {useState, useEffect, useRef, useCallback} from 'react';
// Импорт файла на этапе сборки (альтернативный подход)
// import sampleDocumentUrl from '../../assets/sample-document.docx';

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
   * Create JWT token for ONLYOFFICE API
   * @param {Object} json - Configuration object
   * @param {string} secret - JWT secret
   * @returns {Promise<string>} JWT token
   */
  const createJWT = async (json, secret) => {
    if (!secret) return null;

    const header = {
      typ: 'JWT',
      alg: 'HS256'
    };

    const base64EncodeURL = str => {
      return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    };

    const encodedHeader = base64EncodeURL(JSON.stringify(header));
    const encodedPayload = base64EncodeURL(JSON.stringify(json));
    const encoder = new TextEncoder();
    const algorithm = {name: 'HMAC', hash: 'SHA-256'};
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), algorithm, false, ['sign', 'verify']);
    const buf = encoder.encode(encodedHeader + '.' + encodedPayload);
    const sign = await crypto.subtle.sign(algorithm.name, key, buf);
    const hash = base64EncodeURL(String.fromCharCode(...new Uint8Array(sign)));

    return encodedHeader + '.' + encodedPayload + '.' + hash;
  };

  /**
   * Initialize the ONLYOFFICE editor
   */
  const initEditor = useCallback(async () => {
    const userName = user?.email?.split('@')[0] || 'admin';

    const config = {
      document: {
        fileType: 'docx',
        key: '0' + Math.random(),
        title: 'Example Document',
        url: 'https://static.onlyoffice.com/assets/docs/samples/demo.docx'
      },
      documentType: 'word',
      editorConfig: {
        user: {
          id: userName,
          name: userName
        },
        lang: navigator.language || navigator.userLanguage || 'en'
      },
      height: '100%',
      width: '100%'
    };

    // Mobile detection
    if (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini|Macintosh/i.test(navigator.userAgent) &&
      navigator.maxTouchPoints &&
      navigator.maxTouchPoints > 1
    ) {
      config.type = 'mobile';
    }

    try {
      // Create JWT token (using demo secret for now)
      config.token = await createJWT(config, 'doc-linux');
      setEditorConfig(config);
    } catch (error) {
      console.error('Error creating JWT:', error);
      setEditorConfig(config);
    }
  }, [user]);

  useEffect(() => {
    // Load ONLYOFFICE API script
    const script = document.createElement('script');
    script.src = 'https://doc-linux.teamlab.info/web-apps/apps/api/documents/api.js';
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
