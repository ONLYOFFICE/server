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

exports.DOC_ID_PATTERN = '0-9-.a-zA-Z_=';
exports.DOC_ID_REGEX = new RegExp('^[' + exports.DOC_ID_PATTERN + ']*$', 'i');
exports.DOC_ID_REPLACE_REGEX = new RegExp('[^' + exports.DOC_ID_PATTERN + ']', 'g');
exports.DOC_ID_SOCKET_PATTERN = new RegExp('^/doc/([' + exports.DOC_ID_PATTERN + ']*)/c.+', 'i');
exports.DOC_ID_MAX_LENGTH = 240;
exports.USER_ID_MAX_LENGTH = 240; //255-240=15 symbols to make user id unique
exports.USER_NAME_MAX_LENGTH = 255;
exports.PASSWORD_MAX_LENGTH = 255; //set password limit for DoS protection with long password
exports.EXTENTION_REGEX = /^[a-zA-Z0-9]*$/;
exports.CHAR_DELIMITER = String.fromCharCode(5);
exports.OUTPUT_NAME = 'output';
exports.ONLY_OFFICE_URL_PARAM = 'ooname';
exports.DISPLAY_PREFIX = 'display';
exports.CHANGES_NAME = 'changes';
exports.VIEWER_ONLY = /^(?:(pdf|djvu|xps|oxps))$/;
exports.DEFAULT_DOC_ID = 'docId';
exports.DEFAULT_USER_ID = 'userId';
exports.ALLOWED_PROTO = /^https?$/i;
exports.SHARD_KEY_WOPI_NAME = 'WOPISrc';
exports.SHARD_KEY_API_NAME = 'shardkey';
exports.USER_SESSION_ID_NAME = 'usid';

exports.RIGHTS = {
  None: 0,
  Edit: 1,
  Review: 2,
  Comment: 3,
  View: 4
};

exports.LICENSE_MODE = {
  None: 0,
  Trial: 1,
  Developer: 2,
  Limited: 4
};

exports.LICENSE_RESULT = {
  Error: 1,
  Expired: 2,
  Success: 3,
  UnknownUser: 4,
  Connections: 5,
  ExpiredTrial: 6,
  SuccessLimit: 7,
  UsersCount: 8,
  ConnectionsOS: 9,
  UsersCountOS: 10,
  ExpiredLimited: 11,
  ConnectionsLiveOS: 12,
  ConnectionsLive: 13,
  UsersViewCount: 14,
  UsersViewCountOS: 15,
  NotBefore: 16,
  NotEnoughResources: 17
};

exports.LICENSE_CONNECTIONS = 20;
exports.LICENSE_CONNECTIONS_OS = 0x7fffffff; // max signed 32-bit value
exports.LICENSE_USERS = 3;
exports.LICENSE_EXPIRE_USERS_ONE_DAY = 24 * 60 * 60; // day in seconds

exports.AVS_OFFICESTUDIO_FILE_UNKNOWN = 0x0000;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT = 0x0040;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0004;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0005;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0006;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_MHT = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0007;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0008;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2 = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0009;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_MOBI = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000a;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000b;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000c;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000d;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000e;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000f;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC_FLAT = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0010;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_FLAT = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0011;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML_IN_CONTAINER = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0012;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_PACKAGE = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0014;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0015;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0016;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM_PDF = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0017;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_PAGES = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0018;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_HWP = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0019;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_HWPX = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x001a;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_HWPML = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x001b;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_MD = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x001c;
exports.AVS_OFFICESTUDIO_FILE_DOCUMENT_XML = exports.AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0030;

exports.AVS_OFFICESTUDIO_FILE_PRESENTATION = 0x0080;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0004;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0005;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0006;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0007;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0008;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP_FLAT = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0009;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x000a;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX_PACKAGE = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x000b;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODG = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x000c;
exports.AVS_OFFICESTUDIO_FILE_PRESENTATION_KEY = exports.AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x000d;

exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET = 0x0100;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0004;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0005;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0006;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0007;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0008;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0009;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x000a;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_FLAT = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x000b;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_PACKAGE = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x000c;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_NUMBERS = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x000d;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_TSV = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0014;
exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET_SCSV = exports.AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0024;

exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM = 0x0200;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SWF = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0004;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0005;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0006;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR_MENU = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0007;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR_CANVAS = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0008;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0009;
exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_OFD = exports.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x000a;

exports.AVS_OFFICESTUDIO_FILE_IMAGE = 0x0400;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_JPG = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_TIFF = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_TGA = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_GIF = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0004;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_PNG = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0005;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_EMF = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0006;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_WMF = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0007;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_BMP = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0008;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_CR2 = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x0009;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_PCX = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x000a;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_RAS = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x000b;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_PSD = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x000c;
exports.AVS_OFFICESTUDIO_FILE_IMAGE_ICO = exports.AVS_OFFICESTUDIO_FILE_IMAGE + 0x000d;

exports.AVS_OFFICESTUDIO_FILE_OTHER = 0x0800;
exports.AVS_OFFICESTUDIO_FILE_OTHER_EXTRACT_IMAGE = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_OTHER_MS_OFFCRYPTO = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_OTHER_HTMLZIP = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_OTHER_OLD_DOCUMENT = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0004;
exports.AVS_OFFICESTUDIO_FILE_OTHER_OLD_PRESENTATION = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0005;
exports.AVS_OFFICESTUDIO_FILE_OTHER_OLD_DRAWING = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0006;
exports.AVS_OFFICESTUDIO_FILE_OTHER_OOXML = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0007;
exports.AVS_OFFICESTUDIO_FILE_OTHER_JSON = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0008; // For mail-merge
exports.AVS_OFFICESTUDIO_FILE_OTHER_ZIP = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x0009;
exports.AVS_OFFICESTUDIO_FILE_OTHER_ODF = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x000a;
exports.AVS_OFFICESTUDIO_FILE_OTHER_MS_MITCRYPTO = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x000b;
exports.AVS_OFFICESTUDIO_FILE_OTHER_MS_VBAPROJECT = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x000c;
exports.AVS_OFFICESTUDIO_FILE_OTHER_PACKAGE_IN_OLE = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x000d;
exports.AVS_OFFICESTUDIO_FILE_OTHER_COMPOUND = exports.AVS_OFFICESTUDIO_FILE_OTHER + 0x000e;

exports.AVS_OFFICESTUDIO_FILE_TEAMLAB = 0x1000;
exports.AVS_OFFICESTUDIO_FILE_TEAMLAB_DOCY = exports.AVS_OFFICESTUDIO_FILE_TEAMLAB + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY = exports.AVS_OFFICESTUDIO_FILE_TEAMLAB + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY = exports.AVS_OFFICESTUDIO_FILE_TEAMLAB + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_TEAMLAB_VSDY = exports.AVS_OFFICESTUDIO_FILE_TEAMLAB + 0x0004;

exports.AVS_OFFICESTUDIO_FILE_CANVAS = 0x2000;
exports.AVS_OFFICESTUDIO_FILE_CANVAS_WORD = exports.AVS_OFFICESTUDIO_FILE_CANVAS + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET = exports.AVS_OFFICESTUDIO_FILE_CANVAS + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION = exports.AVS_OFFICESTUDIO_FILE_CANVAS + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_CANVAS_PDF = exports.AVS_OFFICESTUDIO_FILE_CANVAS + 0x0004;
exports.AVS_OFFICESTUDIO_FILE_CANVAS_DRAW = exports.AVS_OFFICESTUDIO_FILE_CANVAS + 0x0005;

exports.AVS_OFFICESTUDIO_FILE_DRAW = 0x4000;
exports.AVS_OFFICESTUDIO_FILE_DRAW_VSDX = exports.AVS_OFFICESTUDIO_FILE_DRAW + 0x0001;
exports.AVS_OFFICESTUDIO_FILE_DRAW_VSSX = exports.AVS_OFFICESTUDIO_FILE_DRAW + 0x0002;
exports.AVS_OFFICESTUDIO_FILE_DRAW_VSTX = exports.AVS_OFFICESTUDIO_FILE_DRAW + 0x0003;
exports.AVS_OFFICESTUDIO_FILE_DRAW_VSDM = exports.AVS_OFFICESTUDIO_FILE_DRAW + 0x0004;
exports.AVS_OFFICESTUDIO_FILE_DRAW_VSSM = exports.AVS_OFFICESTUDIO_FILE_DRAW + 0x0005;
exports.AVS_OFFICESTUDIO_FILE_DRAW_VSTM = exports.AVS_OFFICESTUDIO_FILE_DRAW + 0x0006;

exports.NO_ERROR = 0;
exports.UNKNOWN = -1;
exports.READ_REQUEST_STREAM = -3;
exports.WEB_REQUEST = -4;
exports.CHANGE_DOC_INFO = -5;
exports.TASK_QUEUE = -20;
exports.TASK_RESULT = -40;
exports.STORAGE = -60;
exports.STORAGE_FILE_NO_FOUND = -61;
exports.STORAGE_READ = -62;
exports.STORAGE_WRITE = -63;
exports.STORAGE_REMOVE_DIR = -64;
exports.STORAGE_CREATE_DIR = -65;
exports.STORAGE_GET_INFO = -66;
exports.CONVERT = -80;
exports.CONVERT_DOWNLOAD = -81;
exports.CONVERT_UNKNOWN_FORMAT = -82;
exports.CONVERT_TIMEOUT = -83;
exports.CONVERT_READ_FILE = -84;
exports.CONVERT_DRM_UNSUPPORTED = -85;
exports.CONVERT_CORRUPTED = -86;
exports.CONVERT_LIBREOFFICE = -87;
exports.CONVERT_PARAMS = -88;
exports.CONVERT_NEED_PARAMS = -89;
exports.CONVERT_DRM = -90;
exports.CONVERT_PASSWORD = -91;
exports.CONVERT_ICU = -92;
exports.CONVERT_LIMITS = -93;
exports.CONVERT_ROWLIMITS = -94;
exports.CONVERT_DETECT = -95;
exports.CONVERT_CELLLIMITS = -96;
exports.CONVERT_TEMPORARY = -98;
exports.CONVERT_DEAD_LETTER = -99;
exports.UPLOAD = -100;
exports.UPLOAD_CONTENT_LENGTH = -101;
exports.UPLOAD_EXTENSION = -102;
exports.UPLOAD_COUNT_FILES = -103;
exports.UPLOAD_URL = -104;
exports.VKEY = -120;
exports.VKEY_ENCRYPT = -121;
exports.VKEY_KEY_EXPIRE = -122;
exports.VKEY_USER_COUNT_EXCEED = -123;
exports.VKEY_TIME_EXPIRE = -124;
exports.VKEY_TIME_INCORRECT = -125;
exports.EDITOR_CHANGES = -160;
exports.PASSWORD = -180;
exports.FORCED_VIEW_MODE = -200;
exports.FILE_NOT_ASSEMBLED = -201;

//Quorum queues internally only support two priorities: high and normal.
//Messages without a priority set will be mapped to normal as will priorities 0 - 4.
//Messages with a priority higher than 4 will be mapped to high.
exports.QUEUE_PRIORITY_VERY_LOW = 2;
exports.QUEUE_PRIORITY_LOW = 3;
exports.QUEUE_PRIORITY_NORMAL = 4;
exports.QUEUE_PRIORITY_HIGH = 5;
exports.QUEUE_PRIORITY_VERY_HIGH = 6;

exports.EDITOR_TYPE_WORD = 0;
exports.EDITOR_TYPE_SPREADSHEET = 1;
exports.EDITOR_TYPE_PRESENTATION = 2;
exports.EDITOR_TYPE_CONVERTATION = 3;

exports.PACKAGE_TYPE_OS = 0;
exports.PACKAGE_TYPE_I = 1;
exports.PACKAGE_TYPE_D = 2;

exports.REDIS_KEY_SHUTDOWN = 'shutdown';
exports.REDIS_KEY_LICENSE = 'license';
exports.REDIS_KEY_LICENSE_T = 'licenseT';

exports.SHUTDOWN_CODE = 4001;
exports.SHUTDOWN_REASON = 'server shutdown';
exports.SESSION_IDLE_CODE = 4002;
exports.SESSION_IDLE_REASON = 'idle session expires';
exports.SESSION_ABSOLUTE_CODE = 4003;
exports.SESSION_ABSOLUTE_REASON = 'absolute session expires';
exports.ACCESS_DENIED_CODE = 4004;
exports.ACCESS_DENIED_REASON = 'access deny';
exports.JWT_EXPIRED_CODE = 4005;
exports.JWT_EXPIRED_REASON = 'token:';
exports.JWT_ERROR_CODE = 4006;
exports.JWT_ERROR_REASON = 'token:';

// purpose label for the key that signs the WOPI convert-and-edit status token
exports.JWT_PURPOSE_WOPI_CONVERT = 'wopi-convert-and-edit';

// purpose labels of every inbound token sink; the registry that maps them to keys and rules lives in DocService/sources/jwtService.js
exports.JWT_PURPOSE_CONVERTER = 'converter';
exports.JWT_PURPOSE_DOCBUILDER = 'docbuilder';
// the from-file endpoints have no legacy callers, so they get their own labels and demand the operation claim outright
exports.JWT_PURPOSE_CONVERTER_FROM_FILE = 'converter-from-file';
exports.JWT_PURPOSE_DOCBUILDER_FROM_FILE = 'docbuilder-from-file';
exports.JWT_PURPOSE_COMMAND = 'command';
exports.JWT_PURPOSE_DOWNLOAD = 'download';
// one label per browser sink, but not one token per sink: the config, history and WOPI tokens are each presented at several of them
exports.JWT_PURPOSE_BROWSER_OPEN = 'browser-open';
exports.JWT_PURPOSE_BROWSER_IMGURLS = 'browser-imgurls';
exports.JWT_PURPOSE_BROWSER_DOWNLOADAS = 'browser-downloadas';
exports.JWT_PURPOSE_BROWSER_SAVE_RELATIVE = 'browser-save-relative';
// one token is issued per open document and comes back to every session sink, so the session family has exactly one label
exports.JWT_PURPOSE_EDITOR_SESSION = 'editor-session';
// also the derivation label of the key that signs the print-file URL token
exports.JWT_PURPOSE_PRINT_FILE = 'printfile';

// the claim an integrator puts in the token to state what the token authorizes; the wire values are converter, docbuilder and command, and a from-file route expects the same value as its body counterpart
// download and the browser/session sinks name no operation: they share tokens with each other, so a token addressed to one of them would be refused by the next
exports.JWT_CLAIM_OPERATION = 'operation';
// the operation claim of the tokens Document Server signs for its own outgoing requests; reserved, so no inbound sink accepts a token that carries one
exports.JWT_OUTBOUND_OPERATION_DOWNLOAD = 'download';
exports.JWT_OUTBOUND_OPERATION_CALLBACK = 'callback';
exports.JWT_OUTBOUND_OPERATIONS = [exports.JWT_OUTBOUND_OPERATION_DOWNLOAD, exports.JWT_OUTBOUND_OPERATION_CALLBACK];

exports.DROP_CODE = 4007;
exports.DROP_REASON = 'drop';
exports.UPDATE_VERSION_CODE = 4008;
exports.UPDATE_VERSION = 'update version';
exports.NO_CACHE_CODE = 4009;
exports.NO_CACHE = 'no cache';
exports.RESTORE_CODE = 4010;
exports.RESTORE = 'restore';
exports.QUIET_CODE = 4011; //browser only
exports.QUIET = 'quiet';
exports.RECONNECT_FAILED_CODE = 4012; //browser only
exports.RECONNECT_FAILED = 'reconnect failed';
//update connection error codes

exports.CONTENT_DISPOSITION_INLINE = 'inline';
exports.CONTENT_DISPOSITION_ATTACHMENT = 'attachment';

exports.CONN_CLOSED = 'closed';

exports.FILE_STATUS_OK = 'ok';
exports.FILE_STATUS_UPDATE_VERSION = 'updateversion';

exports.ACTIVEMQ_QUEUE_PREFIX = 'queue://';
exports.ACTIVEMQ_TOPIC_PREFIX = 'topic://';

exports.TEMPLATES_DEFAULT_LOCALE = 'en-US';
//the signing secret shipped in default.json, publicly known and therefore worthless as a key
exports.PUBLIC_DEFAULT_SECRET = 'developer-only-not-a-real-secret';
exports.TABLE_RESULT_SCHEMA = [
  'tenant',
  'id',
  'status',
  'status_info',
  'created_at',
  'last_open_date',
  'user_index',
  'change_id',
  'callback',
  'baseurl',
  'password',
  'additional'
];
exports.TABLE_CHANGES_SCHEMA = ['tenant', 'id', 'change_id', 'user_id', 'user_id_original', 'user_name', 'change_data', 'change_date'];
