import {useState, useEffect, useCallback} from 'react';
import {useSelector, useDispatch} from 'react-redux';
import {selectConfig, saveConfig} from '../../../store/slices/configSlice';
import {registerShowWindowCallback, registerCloseWindowCallback, registerSaveCallback, initAISettings} from '../js/plugins-sdk';

/**
 * Custom hook for managing complete AI plugin functionality
 * Combines plugin windows, settings initialization, and localStorage synchronization
 * @param {Object} statisticsData - Statistics data containing server info
 * @returns {Object} Plugin windows state and handlers
 */
const useAiPlugin = statisticsData => {
  const [pluginWindows, setPluginWindows] = useState([]);
  const dispatch = useDispatch();
  const config = useSelector(selectConfig);

  /**
   * Initialize AI settings after iframe loads
   * @param {string} iframeId - The AI iframe ID
   */
  const handleIframeLoad = useCallback(
    (iframeId = 'ai-iframe') => {
      // Get version information from statistics data
      let sdkVersion = 'develop'; // Default for development

      if (statisticsData?.serverInfo) {
        const {buildVersion} = statisticsData.serverInfo;
        sdkVersion = buildVersion;
      }

      initAISettings(iframeId, sdkVersion);
      console.log('AI Settings initialized with version:', sdkVersion);
    },
    [statisticsData]
  );

  // Synchronize AI config with localStorage
  useEffect(() => {
    // Load AI config from Redux state to localStorage when component mounts/config changes
    localStorage.removeItem('onlyoffice_ai_actions_key');
    localStorage.removeItem('onlyoffice_ai_plugin_storage_key');
    if (config?.aiSettings?.actions) {
      localStorage.setItem('onlyoffice_ai_actions_key', JSON.stringify(config.aiSettings.actions));
    }
    if (config?.aiSettings) {
      const {actions: _actions, timeout: _timeout, allowedCorsOrigins: _allowedCorsOrigins, proxy: _proxy, ...storage_key} = config.aiSettings;
      localStorage.setItem('onlyoffice_ai_plugin_storage_key', JSON.stringify(storage_key));
    }
    // Cleanup: clear localStorage when component unmounts
    return () => {
      localStorage.removeItem('onlyoffice_ai_actions_key');
      localStorage.removeItem('onlyoffice_ai_plugin_storage_key');
      console.log('AI configuration cleared from localStorage');
    };
  }, [config?.aiSettings]);

  // Manage plugin windows and register all SDK callbacks
  useEffect(() => {
    /**
     * Handle showing a plugin window
     * @param {string} iframeId - The iframe ID
     * @param {Object} config - Window configuration
     */
    const handleShowWindow = (iframeId, config) => {
      console.log('showPluginWindow', iframeId, config);
      setPluginWindows(current => {
        // Avoid duplicate windows with same iframeId
        const filtered = current.filter(w => w.iframeId !== iframeId);
        return [...filtered, {iframeId, ...config}];
      });
    };

    /**
     * Handle closing a plugin window
     * @param {string} id - Window ID to close
     */
    const handleCloseWindow = id => {
      setPluginWindows(current => current.filter(w => w.iframeId !== id));
    };

    /**
     * Handle saving AI configuration from localStorage to Redux store
     */
    const handleSave = () => {
      try {
        // Read AI configuration from localStorage
        const aiActionsKey = localStorage.getItem('onlyoffice_ai_actions_key');
        const aiPluginStorageKey = localStorage.getItem('onlyoffice_ai_plugin_storage_key');

        // Prepare updated AI settings
        const updatedAiSettings = {...config?.aiSettings};

        // Update actions if available
        if (aiActionsKey) {
          try {
            const aiActions = JSON.parse(aiActionsKey);
            updatedAiSettings.actions = aiActions;
          } catch (error) {
            console.error('Error parsing AI actions:', error);
          }
        }

        // Update plugin storage settings if available
        if (aiPluginStorageKey) {
          try {
            const pluginStorage = JSON.parse(aiPluginStorageKey);
            Object.assign(updatedAiSettings, pluginStorage);
          } catch (error) {
            console.error('Error parsing AI plugin storage:', error);
          }
        }

        if (aiActionsKey || aiPluginStorageKey) {
          // Create config object with updated AI settings
          const configToSave = {
            aiSettings: updatedAiSettings
          };

          // Save configuration using Redux action
          dispatch(saveConfig(configToSave));
          console.log('AI configuration saved successfully', updatedAiSettings);
        } else {
          console.log('No AI configuration found in localStorage');
        }
      } catch (error) {
        console.error('Error saving AI configuration:', error);
      }
    };

    // Register all callbacks with SDK
    registerShowWindowCallback(handleShowWindow);
    registerCloseWindowCallback(handleCloseWindow);
    registerSaveCallback(handleSave);

    // Cleanup: unregister all callbacks
    return () => {
      registerShowWindowCallback(null);
      registerCloseWindowCallback(null);
      registerSaveCallback(null);
    };
  }, [config, dispatch]);

  const currentWindow = pluginWindows.length > 0 ? pluginWindows[pluginWindows.length - 1] : null;

  return {
    pluginWindows,
    currentWindow,
    handleIframeLoad
  };
};

export default useAiPlugin;
