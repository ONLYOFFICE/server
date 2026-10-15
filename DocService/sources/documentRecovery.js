/*
 * Copyright (C) Ascensio System SIA, 2009-2026
 *
 * This program is a free software product. You can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License (AGPL)
 * version 3 as published by the Free Software Foundation, together with the
 * additional terms provided in the LICENSE file.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. For
 * details, see the GNU AGPL at: https://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA by email at info@onlyoffice.com
 * or by postal mail at 20A-6 Ernesta Birznieka-Upisha Street, Riga,
 * LV-1050, Latvia, European Union.
 *
 * The interactive user interfaces in modified versions of the Program
 * are required to display Appropriate Legal Notices in accordance with
 * Section 5 of the GNU AGPL version 3.
 *
 * No trademark rights are granted under this License.
 *
 * All non-code elements of the Product, including illustrations,
 * icon sets, and technical writing content, are licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License:
 * https://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 * This license applies only to such non-code elements and does not
 * modify or replace the licensing terms applicable to the Program's
 * source code, which remains licensed under the GNU Affero General
 * Public License v3.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

const constants = require('./../../Common/sources/constants');
const commonDefines = require('./../../Common/sources/commondefines');

// Ok + FILE_NOT_ASSEMBLED marks a failed-assembly doc; pending changes are kept for replay; the marker is overwritten by the next status change (save retry, empty-cache reconvert, or successful assembly).
function markAssemblyRecovery(task) {
  task.status = commonDefines.FileStatus.Ok;
  task.statusInfo = constants.FILE_NOT_ASSEMBLED;
}

// Exact marker only; do not infer recovery from arbitrary negative status_info left by legacy paths.
function isAssemblyRecoveryStatus(status, statusInfo) {
  return status === commonDefines.FileStatus.Ok && statusInfo === constants.FILE_NOT_ASSEMBLED;
}

function isAssemblyRecovery(row) {
  return isAssemblyRecoveryStatus(row?.status, row?.status_info);
}

exports.markAssemblyRecovery = markAssemblyRecovery;
exports.isAssemblyRecovery = isAssemblyRecovery;
exports.isAssemblyRecoveryStatus = isAssemblyRecoveryStatus;
