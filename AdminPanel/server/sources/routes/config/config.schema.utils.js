/*
 * ONLYOFFICE Document Server
 * Copyright (c) Ascensio System SIA. All rights reserved.
 *
 * This program is a free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * ONLYOFFICE is a trademark of Ascensio System SIA. Other brand and product
 * names mentioned herein may be trademarks of their respective owners.
 */

'use strict';

// Constants
const X_SCOPE_KEYWORD = 'x-scope';
const SCHEMA_COMBINATORS = ['anyOf', 'oneOf', 'allOf'];
const SCHEMA_DEFINITIONS = ['definitions', '$defs'];

/**
 * Checks if a node should be included in the target scope.
 * @param {any} node
 * @param {string} scope
 * @returns {boolean}
 */
function isNodeAllowedInScope(node, scope) {
  if (!node || typeof node !== 'object') return true;
  if (!Object.prototype.hasOwnProperty.call(node, X_SCOPE_KEYWORD)) return true;

  const marker = node[X_SCOPE_KEYWORD];
  return Array.isArray(marker) ? marker.includes(scope) : marker === scope;
}

/**
 * Processes object properties by pruning each property.
 * @param {Object} properties
 * @param {Function} pruneFn
 * @returns {Object}
 */
function processObjectProperties(properties, pruneFn) {
  const newProps = {};
  for (const [key, value] of Object.entries(properties)) {
    const pruned = pruneFn(value);
    if (pruned) newProps[key] = pruned;
  }
  return newProps;
}

/**
 * Processes schema combinators (anyOf, oneOf, allOf).
 * @param {Object} result
 * @param {Function} pruneFn
 */
function processCombinators(result, pruneFn) {
  for (const key of SCHEMA_COMBINATORS) {
    if (Array.isArray(result[key])) {
      const mapped = result[key].map(pruneFn).filter(Boolean);
      if (mapped.length === 0) delete result[key];
      else result[key] = mapped;
    }
  }
}

/**
 * Processes schema definitions (definitions, $defs).
 * @param {Object} result
 * @param {Function} pruneFn
 */
function processDefinitions(result, pruneFn) {
  for (const defKey of SCHEMA_DEFINITIONS) {
    if (result[defKey] && typeof result[defKey] === 'object') {
      result[defKey] = processObjectProperties(result[defKey], pruneFn);
    }
  }
}

/**
 * Processes conditional schemas (if/then/else).
 * @param {Object} result
 * @param {Function} pruneFn
 */
function processConditionals(result, pruneFn) {
  if (!result.if) return;

  const pIf = pruneFn(result.if);
  if (pIf === null) delete result.if;
  else result.if = pIf;

  if (result.then) {
    const pThen = pruneFn(result.then);
    if (pThen === null) delete result.then;
    else result.then = pThen;
  }

  if (result.else) {
    const pElse = pruneFn(result.else);
    if (pElse === null) delete result.else;
    else result.else = pElse;
  }
}

/**
 * Build a per-scope schema by pruning nodes marked with x-scope.
 * @param {object} schema - Superset JSON schema object
 * @param {'admin'|'tenant'} scope - Target scope
 * @returns {object} Derived schema for scope
 */
function deriveSchemaForScope(schema, scope) {
  const prune = node => {
    if (!node || typeof node !== 'object') return node;
    if (!isNodeAllowedInScope(node, scope)) return null;

    const result = Array.isArray(node) ? node.map(prune).filter(Boolean) : {...node};
    if (result[X_SCOPE_KEYWORD] !== undefined) delete result[X_SCOPE_KEYWORD];

    // Handle object properties
    if (result.type === 'object') {
      if (result.properties && typeof result.properties === 'object') {
        result.properties = processObjectProperties(result.properties, prune);
      }
      if (result.patternProperties && typeof result.patternProperties === 'object') {
        result.patternProperties = processObjectProperties(result.patternProperties, prune);
      }
      if (Array.isArray(result.required)) {
        result.required = result.required.filter(k => result.properties && Object.prototype.hasOwnProperty.call(result.properties, k));
        if (result.required.length === 0) delete result.required;
      }
      if (typeof result.additionalProperties === 'object') {
        const prunedAP = prune(result.additionalProperties);
        result.additionalProperties = prunedAP === null ? false : prunedAP;
      }
    }

    // Handle array items
    if (result.items) {
      const prunedItems = prune(result.items);
      if (prunedItems === null) delete result.items;
      else result.items = prunedItems;
    }

    processCombinators(result, prune);
    processConditionals(result, prune);
    processDefinitions(result, prune);

    return result;
  };

  const derived = prune(schema);
  if (derived && typeof derived === 'object') {
    derived.$id = derived.$id ? `${derived.$id}:${scope}` : `urn:onlyoffice:config:derived:${scope}`;
  }
  return derived;
}

module.exports = {
  deriveSchemaForScope,
  X_SCOPE_KEYWORD
};
