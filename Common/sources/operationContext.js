/*
 * (c) Copyright Ascensio System SIA 2010-2023
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
 * You can contact Ascensio System SIA at 20A-12 Ernesta Birznieka-Upisha
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

const utils = require('./utils');
const logger = require('./logger');
const constants = require('./constants');
const tenantManager = require('./tenantManager');

function Context(){
  this.logger = logger.getLogger('nodeJS');
  this.initDefault();
}
Context.prototype.init = function(tenant, docId, userId) {
  this.setTenant(tenant);
  this.setDocId(docId);
  this.setUserId(userId);
};
Context.prototype.initDefault = function() {
  this.init(tenantManager.getDefautTenant(), constants.DEFAULT_DOC_ID, constants.DEFAULT_USER_ID);
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
  this.init(tenant, docId || this.docId, userId || this.userId);
};
Context.prototype.initFromRequest = function(req) {
  let tenant = tenantManager.getTenantByRequest(this, req);
  this.init(tenant, this.docId, this.userId);
};
Context.prototype.initFromTaskQueueData = function(task) {
  let ctx = task.getCtx();
  this.init(ctx.tenant, ctx.docId, ctx.userId);
};
Context.prototype.initFromPubSub = function(data) {
  let ctx = data.ctx;
  this.init(ctx.tenant, ctx.docId, ctx.userId);
};

Context.prototype.setTenant = function(tenant) {
  this.tenant = tenant;
  this.logger.addContext('TENANT', tenant);
};
Context.prototype.setDocId = function(docId) {
  this.docId = docId;
  this.logger.addContext('DOCID', docId);
};
Context.prototype.setUserId = function(userId) {
  this.userId = userId;
  this.logger.addContext('USERID', userId);
};

exports.Context = Context;
exports.global = new Context();
