/*
 * (c) Copyright Ascensio System SIA 2010-2019
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
const tenantManager = require('../../DocService/sources/tenantManager');

function OperationContext(){
  this.logger = logger.getLogger('nodeJS');
  this.init(constants.DEFAULT_TENANT, constants.DEFAULT_DOC_ID, constants.DEFAULT_USER_ID);
}
OperationContext.prototype.init = function(tenant, docId, userId) {
  this.setTenant(tenant);
  this.setDocId(docId);
  this.setUserId(userId);
};
OperationContext.prototype.initFromConnection = function(conn) {
  let tm = new tenantManager.TenantManager();
  let tenant = tm.getTenant(utils.getDomainByConnection(conn));
  let docId = conn.docid;
  if (!docId) {
    const docIdParsed = constants.DOC_ID_SOCKET_PATTERN.exec(conn.url);
    if (docIdParsed && 1 < docIdParsed.length) {
      docId = docIdParsed[1];
    }
  }
  let userId = conn.user?.id;
  this.init(tenant, docId, userId);
};
OperationContext.prototype.initFromRequest = function(req) {
  let tm = new tenantManager.TenantManager();
  let tenant = tm.getTenant(utils.getDomainByRequest(req));
  this.init(tenant, this.docId, this.userId);
};
OperationContext.prototype.initFromTaskQueueData = function(task) {
  //todo
  this.init(this.tenant, this.docId, this.userId);
};

OperationContext.prototype.setTenant = function(tenant) {
  this.tenant = tenant;
  this.logger.addContext('TENANT', tenant);
};
OperationContext.prototype.setDocId = function(docId) {
  this.docId = docId;
  this.logger.addContext('DOCID', docId);
};
OperationContext.prototype.setUserId = function(userId) {
  this.userId = userId;
  this.logger.addContext('USERID', userId);
};

exports.OperationContext = OperationContext;
exports.globalCtx = new OperationContext();
