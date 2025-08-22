/*
 * (c) Copyright Ascensio System SIA 2010-2024
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation. In accordance with
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at 20A-6 Ernesta Birznieka-Upish
 * street, Riga, Latvia, EU, LV-1050.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */

'use strict';

const { buffer } = require('node:stream/consumers');
const config = require('config');
const utils = require('../../../Common/sources/utils');
const operationContext = require('../../../Common/sources/operationContext');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Configuration constants
const cfgAiApiTimeout = config.get('aiSettings.timeout');
const cfgAiPluginDir = config.get('aiSettings.pluginDir');

const engineScriptsDir = path.join(cfgAiPluginDir, 'scripts/engine');

function setCtx(ctx) {
  sandbox.ctx = ctx;
  console.log = ctx.logger.debug.bind(ctx.logger);//todo make default in logger
  console.error = ctx.logger.error.bind(ctx.logger);
}

// Set up the environment for the client-side engine.js
const sandbox = {
  ctx: null,
  window: {
    AI: {
      TmpProviderForModels: null,
      Providers: {},
      InternalProviders: [],
      _getHeaders: function() {return {};},
      _getEndpointUrl: function() {return "";},
      serializeProviders: function() {return [];},
      ActionsGetSorted: function() {return [];},
      getModels: function() {return [];},
      onLoadInternalProviders: function() {},
      Storage: {
        serializeModels: function() {return [];}
      },
      CapabilitiesUI: {}
    }
  },
  Asc: {
    plugin: {
      tr: function(text) {
        // Just return the original text in the stub
        return text;
      }
    }
  },
  
  /**
   * Implementation of fetch that delegates to utils.httpRequest
   * 
   * @param {string} url - The URL to fetch
   * @param {Object} options - Fetch options (method, headers, body)
   * @returns {Promise<Object>} - A promise that resolves to a response-like object
   */
  fetch: function(url, options = {}) {
    const ctx = sandbox.ctx;
    const method = options.method || 'GET';
    
    // Configure timeout options for the request
    const timeoutOptions = {
      connectionAndInactivity: cfgAiApiTimeout,
      wholeCycle: cfgAiApiTimeout
    };
    ctx.logger.debug("engineWrapper fetch", url, options);
    return utils.httpRequest(
      sandbox.ctx,
      method,
      url,
      options.headers || {},
      options.body || null,
      timeoutOptions,
      null,
      true //true because request limited by local network
    )
    .then(async (result) => {
      const responseBuffer = await buffer(result.stream);
      const text = responseBuffer.toString('utf8');
      
      return {
        status: result.response.status,
        statusText: result.response.statusText,
        ok: result.response.status >= 200 && result.response.status < 300,
        headers: result.response.headers,
        text: () => Promise.resolve(text),
        json: () => Promise.resolve(JSON.parse(text)),
        arrayBuffer: () => Promise.resolve(responseBuffer.buffer)
      };
    });
  }
};

// Initialize minimal AI object with required functionality
sandbox.AI = sandbox.window.AI;
setCtx(operationContext.global);

/**
 * Simple loadInternalProviders implementation
 */
function loadInternalProviders() {
  // Add simple provider loading logic
  const enginePath = path.join(engineScriptsDir, 'providers/internal');
  
  // Check if the providers directory exists before trying to read it
  if (!fs.existsSync(enginePath)) {
    sandbox.ctx.logger.warn('Internal providers directory not found:', enginePath);
    sandbox.AI.onLoadInternalProviders();
    return;
  }

  try {
    // Read providers directory
    const files = fs.readdirSync(enginePath);
    
    // Load each provider
    for (const file of files) {
      if (file.endsWith('.js')) {
        const providerPath = path.join(enginePath, file);
        const providerCode = fs.readFileSync(providerPath, 'utf8');
        
        try {
          //sandbox.ctx.logger.debug(`Loading provider ${file}:`);
          let content = "(function(){\n" + providerCode + "\nreturn new Provider();})();";
          // Execute provider code in sandbox
          let provider = vm.runInNewContext(content, sandbox, {
            filename: file,
            timeout: 5000
          });
          sandbox.AI.InternalProviders.push(provider);
        } catch (error) {
          sandbox.ctx.logger.error(`Error loading provider ${file}:`, error);
        }
      }
    }

    sandbox.AI.onLoadInternalProviders();
  } catch (error) {
    sandbox.ctx.logger.error('Error loading internal providers:', error);
  }
}

// Load engine.js
let engineCode = '';

try {
  engineCode += fs.readFileSync(path.join(engineScriptsDir, 'storage.js'), 'utf8');
  engineCode += fs.readFileSync(path.join(engineScriptsDir, 'local_storage.js'), 'utf8');
  engineCode += fs.readFileSync(path.join(engineScriptsDir, 'providers/base.js'), 'utf8');
  engineCode += fs.readFileSync(path.join(engineScriptsDir, 'providers/provider.js'), 'utf8');
  engineCode += fs.readFileSync(path.join(engineScriptsDir, 'engine.js'), 'utf8');
} catch (error) {
  sandbox.ctx.logger.warn('Error reading engine script files:', error);
}

// Run engine code if available
if (engineCode) {
  try {
    vm.runInNewContext(engineCode, sandbox);
  } catch (error) {
    sandbox.ctx.logger.error('Error executing engine scripts:', error);
  }
}

//start from engine/register.js
(function() {
  const AI = sandbox.AI;
  const Asc = sandbox.Asc;

  AI.ActionType = {
    Chat             : "Chat",
    Summarization    : "Summarization",
    Translation      : "Translation",
    TextAnalyze      : "TextAnalyze",
    ImageGeneration  : "ImageGeneration",
    OCR              : "OCR",
    Vision           : "Vision"
  };

  AI.Actions = {};

  function ActionUI(name, icon, modelId, capabilities) {
    this.name = name || "";
    this.icon = icon || "";
    this.model = modelId || "";
    this.capabilities = (capabilities === undefined) ? AI.CapabilitiesUI.Chat : capabilities;
  }

  AI.Actions[AI.ActionType.Chat]            = new ActionUI("Chatbot", "ask-ai");
  AI.Actions[AI.ActionType.Summarization]   = new ActionUI("Summarization", "summarization");
  AI.Actions[AI.ActionType.Translation]     = new ActionUI("Translation", "translation");
  AI.Actions[AI.ActionType.TextAnalyze]     = new ActionUI("Text analysis", "text-analysis-ai");
  AI.Actions[AI.ActionType.ImageGeneration] = new ActionUI("Image generation", "image-ai", "", AI.CapabilitiesUI.Image);
  AI.Actions[AI.ActionType.OCR]             = new ActionUI("OCR", "text-analysis-ai", "", AI.CapabilitiesUI.Vision);
  AI.Actions[AI.ActionType.Vision]          = new ActionUI("Vision", "vision-ai", "", AI.CapabilitiesUI.Vision);

  AI.ActionsGetKeys = function()
  {
    return [
      AI.ActionType.Chat,
      AI.ActionType.Summarization,
      AI.ActionType.Translation,
      AI.ActionType.TextAnalyze,
      AI.ActionType.ImageGeneration,
      AI.ActionType.OCR,
      AI.ActionType.Vision
    ];
  };

  AI.ActionsGetSorted = function()
  {
    let keys = AI.ActionsGetKeys();
    let count = keys.length;
    let actions = new Array(count);
    for (let i = 0; i < count; i++)
    {
      let src = AI.Actions[keys[i]];
      actions[i] = {
        id : keys[i],
        name : Asc.plugin.tr(src.name),
        icon : src.icon,
        model : src.model,
        capabilities : src.capabilities
      }
    }
    return actions;
  };
  //end from engine/register.js
})();

sandbox.AI.loadInternalProviders = loadInternalProviders;
loadInternalProviders();

exports.setCtx = setCtx;
exports.AI = sandbox.AI;
