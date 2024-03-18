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
const { v4: uuid } = require('uuid');

const utils = require('./utils');
const logger = require('./logger');
const constants = require('./constants');
const tenantManager = require('./tenantManager');

const activeSessions = new Map();

function Context(){
  this.logger = logger.getLogger('nodeJS');
  this.initDefault();
}
Context.prototype.init = function(tenant, docId, userId, opt_shardKey, opt_WopiSrc, opt_UserIdOriginal) {
  this.setTenant(tenant);
  this.setDocId(docId);
  this.setUserId(userId);
  this.setShardKey(opt_shardKey);
  this.setWopiSrc(opt_WopiSrc);
  this.setUserIdOriginal(opt_UserIdOriginal);

  if (!this.logIdsRestoreFromMap()) {
    this.setSessionId(constants.DEFAULT_SESSION_ID);
    this.setCorrelationId(constants.DEFAULT_CORRELATION_ID);
  }

  this.config = null;
  this.secret = null;
  this.license = null;
};
Context.prototype.initDefault = function() {
  this.init(tenantManager.getDefautTenant(), constants.DEFAULT_DOC_ID, constants.DEFAULT_USER_ID, undefined);
};
Context.prototype.initFromConnection = function(conn) {
  let tenant = tenantManager.getTenantByConnection(this, conn);
  let docId = conn.docid;
  if (!docId) {
    let handshake = conn.handshake;
    const docIdParsed = constants.DOC_ID_SOCKET_PATTERN.exec(handshake.url);
    if (docIdParsed && 1 < docIdParsed.length) {
      docId = docIdParsed[1];
    }
  }
  let userId = conn.user?.id;
  let shardKey = utils.getShardKeyByConnection(this, conn);
  let wopiSrc = utils.getWopiSrcByConnection(this, conn);
  const userIdOriginal = conn.user?.idOriginal;
  this.init(tenant, docId || this.docId, userId || this.userId, shardKey, wopiSrc, userIdOriginal);
};
Context.prototype.initFromRequest = function(req) {
  let tenant = tenantManager.getTenantByRequest(this, req);
  let shardKey = utils.getShardKeyByRequest(this, req);
  let wopiSrc = utils.getWopiSrcByRequest(this, req);
  this.init(tenant, this.docId, this.userId, shardKey, wopiSrc);
};
Context.prototype.initFromTaskQueueData = function(task) {
  let ctx = task.getCtx();
  this.init(ctx.tenant, ctx.docId, ctx.userId, ctx.shardKey, ctx.wopiSrc/*, ctx.userIdOriginal*/);
  this.logsIdsRestoreFromContext(ctx);
};
Context.prototype.initFromPubSub = function(data) {
  let ctx = data.ctx;
  this.init(ctx.tenant, ctx.docId, ctx.userId, ctx.shardKey, ctx.wopiSrc/*, ctx.userIdOriginal*/);
  this.logsIdsRestoreFromContext(ctx);
};
Context.prototype.initTenantCache = async function() {
  this.config = await tenantManager.getTenantConfig(this);
  //todo license and secret
};
Context.prototype.setLogsTracingIds = function(req) {
  const defaultId = uuid();
  const ids = {
    sessionId: req.query['usid'] ?? defaultId,
    correlationId: req.query['corrid'] ?? defaultId
  };

  if (!this.tenant || !this.userIdOriginal || !this.docId) {
    this.setSessionId(constants.DEFAULT_SESSION_ID);
    this.setCorrelationId(constants.DEFAULT_CORRELATION_ID);

    return;
  }

  const key = `${this.tenant}_${this.userIdOriginal}_${this.docId}`;
  const existedIds = activeSessions.get(key);
  if (existedIds) {
    this.setSessionId(existedIds.sessionId);
    this.setCorrelationId(existedIds.correlationId);

    return;
  }

  activeSessions.set(key, { sessionId: ids.sessionId, correlationId: ids.correlationId });
  this.setSessionId(ids.sessionId);
  this.setCorrelationId(ids.correlationId);
}
Context.prototype.logIdsRestoreFromMap = function() {
  const key = `${this.tenant}_${this.userIdOriginal}_${this.docId}`;
  const logIds = activeSessions.get(key);
  if (!logIds) {
    return false;
  }

  this.setSessionId(logIds.sessionId);
  this.setCorrelationId(logIds.correlationId);

  return true;
}
Context.prototype.logsIdsRestoreFromContext = function(ctx) {
  this.setSessionId(ctx.sessionId);
  this.setCorrelationId(ctx.correlationId);
}

Context.prototype.setTenant = function(tenant) {
  this.tenant = tenant;
  this.logIdsRestoreFromMap();
  this.logger.addContext('TENANT', tenant);
};
Context.prototype.setDocId = function(docId) {
  this.docId = docId;
  this.logIdsRestoreFromMap();
  this.logger.addContext('DOCID', docId);
};
Context.prototype.setUserId = function(userId) {
  this.userId = userId;
  this.logger.addContext('USERID', userId);
};
Context.prototype.setSessionId = function(sessionId) {
  this.sessionId = sessionId;
  this.logger.addContext('SESSIONID', sessionId);
}
Context.prototype.setCorrelationId = function(correlationId) {
  this.correlationId = correlationId;
  this.logger.addContext('CORRELATIONID', correlationId);
}
Context.prototype.setUserIdOriginal = function (userIdOriginal) {
  this.userIdOriginal = userIdOriginal;
  this.logIdsRestoreFromMap();
}
Context.prototype.setShardKey = function(shardKey) {
  this.shardKey = shardKey;
};
Context.prototype.setWopiSrc = function(wopiSrc) {
  this.wopiSrc = wopiSrc;
};
Context.prototype.getSessionId = function() {
  return this.sessionId;
}
Context.prototype.getCorrelationId = function() {
  return this.correlationId;
}
Context.prototype.deleteLogIdsSession = function() {
  const key = `${this.tenant}_${this.userIdOriginal}_${this.docId}`;
  activeSessions.delete(key);
}
Context.prototype.toJSON = function() {
  return {
    tenant: this.tenant,
    docId: this.docId,
    userId: this.userId,
    shardKey: this.shardKey,
    wopiSrc: this.wopiSrc,
    sessionId: this.sessionId,
    correlationId: this.correlationId
  }
};
Context.prototype.getCfg = function(property, defaultValue) {
  if (this.config){
    return getImpl(this.config, property) ?? defaultValue;
  }
  return defaultValue;
};

/**
 * Underlying get mechanism
 *
 * @private
 * @method getImpl
 * @param object {object} - Object to get the property for
 * @param property {string | array[string]} - The property name to get (as an array or '.' delimited string)
 * @return value {*} - Property value, including undefined if not defined.
 */
function getImpl(object, property) {
  //from https://github.com/node-config/node-config/blob/a8b91ac86b499d11b90974a2c9915ce31266044a/lib/config.js#L137
  var t = this,
    elems = Array.isArray(property) ? property : property.split('.'),
    name = elems[0],
    value = object[name];
  if (elems.length <= 1) {
    return value;
  }
  // Note that typeof null === 'object'
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  return getImpl(value, elems.slice(1));
};

exports.Context = Context;
exports.global = new Context();
