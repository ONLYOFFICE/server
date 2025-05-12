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

export const DOC_ID_PATTERN = '0-9-.a-zA-Z_=';
export const DOC_ID_REGEX = new RegExp("^[" + DOC_ID_PATTERN + "]*$", 'i');
export const DOC_ID_REPLACE_REGEX = new RegExp("[^" + DOC_ID_PATTERN + "]", 'g');
export const DOC_ID_SOCKET_PATTERN = new RegExp("^/doc/([" + DOC_ID_PATTERN + "]*)/c.+", 'i');
export const DOC_ID_MAX_LENGTH = 240;
export const USER_ID_MAX_LENGTH = 240;//255-240=15 symbols to make user id unique
export const USER_NAME_MAX_LENGTH = 255;
export const PASSWORD_MAX_LENGTH = 255;//set password limit for DoS protection with long password
export const EXTENTION_REGEX = /^[a-zA-Z0-9]*$/;
export const CHAR_DELIMITER = String.fromCharCode(5);
export const OUTPUT_NAME = 'output';
export const ONLY_OFFICE_URL_PARAM = 'ooname';
export const DISPLAY_PREFIX = 'display';
export const CHANGES_NAME = 'changes';
export const VIEWER_ONLY = /^(?:(pdf|djvu|xps|oxps))$/;
export const DEFAULT_DOC_ID = 'docId';
export const DEFAULT_USER_ID = 'userId';
export const ALLOWED_PROTO = /^https?$/i;
export const SHARD_KEY_WOPI_NAME = 'WOPISrc';
export const SHARD_KEY_API_NAME = 'shardkey';

export const RIGHTS = {
  None    : 0,
  Edit    : 1,
  Review  : 2,
  Comment : 3,
  View    : 4
};

export const LICENSE_MODE = {
  None: 0,
  Trial: 1,
  Developer: 2,
  Limited: 4
};

export const LICENSE_RESULT = {
  Error         : 1,
  Expired       : 2,
  Success       : 3,
  UnknownUser   : 4,
  Connections   : 5,
  ExpiredTrial  : 6,
  SuccessLimit  : 7,
  UsersCount    : 8,
  ConnectionsOS : 9,
  UsersCountOS  : 10,
  ExpiredLimited: 11,
  ConnectionsLiveOS: 12,
  ConnectionsLive: 13,
  UsersViewCount: 14,
  UsersViewCountOS: 15,
  NotBefore: 16
};

export const LICENSE_CONNECTIONS = 20;
export const LICENSE_USERS = 3;
export const LICENSE_EXPIRE_USERS_ONE_DAY = 24 * 60 * 60; // day in seconds

export const AVS_OFFICESTUDIO_FILE_UNKNOWN =  0x0000;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT = 0x0040;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0001;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0002;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0003;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0004;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0005;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0006;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_MHT = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0007;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0008;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2 = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0009;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_MOBI = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000a;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000b;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000c;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000d;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000e;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x000f;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC_FLAT = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0010;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_FLAT = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0011;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML_IN_CONTAINER = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0012;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_PACKAGE = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0014;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0015;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0016;
export const AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM_PDF = AVS_OFFICESTUDIO_FILE_DOCUMENT + 0x0017;

export const AVS_OFFICESTUDIO_FILE_PRESENTATION = 0x0080;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0001;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0002;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0003;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0004;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0005;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0006;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0007;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0008;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP_FLAT = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x0009;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x000a;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX_PACKAGE = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x000b;
export const AVS_OFFICESTUDIO_FILE_PRESENTATION_ODG  = AVS_OFFICESTUDIO_FILE_PRESENTATION + 0x000c;

export const AVS_OFFICESTUDIO_FILE_SPREADSHEET = 0x0100;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0001;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0002;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0003;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0004;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0005;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0006;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0007;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0008;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x0009;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x000a;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_FLAT = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x000b;
export const AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_PACKAGE = AVS_OFFICESTUDIO_FILE_SPREADSHEET + 0x000c;

export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM = 0x0200;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0001;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SWF = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0002;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0003;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0004;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0005;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0006;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR_MENU = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0007;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR_CANVAS = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0008;
export const AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA = AVS_OFFICESTUDIO_FILE_CROSSPLATFORM + 0x0009;

export const AVS_OFFICESTUDIO_FILE_IMAGE = 0x0400;
export const AVS_OFFICESTUDIO_FILE_IMAGE_JPG = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0001;
export const AVS_OFFICESTUDIO_FILE_IMAGE_TIFF = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0002;
export const AVS_OFFICESTUDIO_FILE_IMAGE_TGA = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0003;
export const AVS_OFFICESTUDIO_FILE_IMAGE_GIF = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0004;
export const AVS_OFFICESTUDIO_FILE_IMAGE_PNG = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0005;
export const AVS_OFFICESTUDIO_FILE_IMAGE_EMF = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0006;
export const AVS_OFFICESTUDIO_FILE_IMAGE_WMF = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0007;
export const AVS_OFFICESTUDIO_FILE_IMAGE_BMP = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0008;
export const AVS_OFFICESTUDIO_FILE_IMAGE_CR2 = AVS_OFFICESTUDIO_FILE_IMAGE + 0x0009;
export const AVS_OFFICESTUDIO_FILE_IMAGE_PCX = AVS_OFFICESTUDIO_FILE_IMAGE + 0x000a;
export const AVS_OFFICESTUDIO_FILE_IMAGE_RAS = AVS_OFFICESTUDIO_FILE_IMAGE + 0x000b;
export const AVS_OFFICESTUDIO_FILE_IMAGE_PSD = AVS_OFFICESTUDIO_FILE_IMAGE + 0x000c;
export const AVS_OFFICESTUDIO_FILE_IMAGE_ICO = AVS_OFFICESTUDIO_FILE_IMAGE + 0x000d;

export const AVS_OFFICESTUDIO_FILE_OTHER = 0x0800;
export const AVS_OFFICESTUDIO_FILE_OTHER_EXTRACT_IMAGE = AVS_OFFICESTUDIO_FILE_OTHER + 0x0001;
export const AVS_OFFICESTUDIO_FILE_OTHER_MS_OFFCRYPTO = AVS_OFFICESTUDIO_FILE_OTHER + 0x0002;
export const AVS_OFFICESTUDIO_FILE_OTHER_HTMLZIP = AVS_OFFICESTUDIO_FILE_OTHER + 0x0003;
export const AVS_OFFICESTUDIO_FILE_OTHER_OLD_DOCUMENT = AVS_OFFICESTUDIO_FILE_OTHER + 0x0004;
export const AVS_OFFICESTUDIO_FILE_OTHER_OLD_PRESENTATION = AVS_OFFICESTUDIO_FILE_OTHER + 0x0005;
export const AVS_OFFICESTUDIO_FILE_OTHER_OLD_DRAWING = AVS_OFFICESTUDIO_FILE_OTHER + 0x0006;
export const AVS_OFFICESTUDIO_FILE_OTHER_OOXML = AVS_OFFICESTUDIO_FILE_OTHER + 0x0007;
export const AVS_OFFICESTUDIO_FILE_OTHER_JSON = AVS_OFFICESTUDIO_FILE_OTHER + 0x0008; // Для mail-merge
export const AVS_OFFICESTUDIO_FILE_OTHER_ODF = AVS_OFFICESTUDIO_FILE_OTHER + 0x000a;
export const AVS_OFFICESTUDIO_FILE_OTHER_MS_MITCRYPTO = AVS_OFFICESTUDIO_FILE_OTHER + 0x000b;
export const AVS_OFFICESTUDIO_FILE_OTHER_MS_VBAPROJECT = AVS_OFFICESTUDIO_FILE_OTHER + 0x000c;
export const AVS_OFFICESTUDIO_FILE_OTHER_PACKAGE_IN_OLE = AVS_OFFICESTUDIO_FILE_OTHER + 0x000d;

export const AVS_OFFICESTUDIO_FILE_TEAMLAB = 0x1000;
export const AVS_OFFICESTUDIO_FILE_TEAMLAB_DOCY = AVS_OFFICESTUDIO_FILE_TEAMLAB + 0x0001;
export const AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY = AVS_OFFICESTUDIO_FILE_TEAMLAB + 0x0002;
export const AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY = AVS_OFFICESTUDIO_FILE_TEAMLAB + 0x0003;

export const AVS_OFFICESTUDIO_FILE_CANVAS = 0x2000;
export const AVS_OFFICESTUDIO_FILE_CANVAS_WORD = AVS_OFFICESTUDIO_FILE_CANVAS + 0x0001;
export const AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET = AVS_OFFICESTUDIO_FILE_CANVAS + 0x0002;
export const AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION = AVS_OFFICESTUDIO_FILE_CANVAS + 0x0003;
export const AVS_OFFICESTUDIO_FILE_CANVAS_PDF = AVS_OFFICESTUDIO_FILE_CANVAS + 0x0004;

export const AVS_OFFICESTUDIO_FILE_DRAW  = 0x4000;
export const AVS_OFFICESTUDIO_FILE_DRAW_VSDX = AVS_OFFICESTUDIO_FILE_DRAW + 0x0001;
export const AVS_OFFICESTUDIO_FILE_DRAW_VSSX = AVS_OFFICESTUDIO_FILE_DRAW + 0x0002;
export const AVS_OFFICESTUDIO_FILE_DRAW_VSTX = AVS_OFFICESTUDIO_FILE_DRAW + 0x0003;
export const AVS_OFFICESTUDIO_FILE_DRAW_VSDM = AVS_OFFICESTUDIO_FILE_DRAW + 0x0004;
export const AVS_OFFICESTUDIO_FILE_DRAW_VSSM = AVS_OFFICESTUDIO_FILE_DRAW + 0x0005;
export const AVS_OFFICESTUDIO_FILE_DRAW_VSTM = AVS_OFFICESTUDIO_FILE_DRAW + 0x0006;

export const NO_ERROR = 0;
export const UNKNOWN = -1;
export const READ_REQUEST_STREAM = -3;
export const WEB_REQUEST = -4;
export const CHANGE_DOC_INFO = -5;
export const TASK_QUEUE = -20;
export const TASK_RESULT = -40;
export const STORAGE = -60;
export const STORAGE_FILE_NO_FOUND = -61;
export const STORAGE_READ = -62;
export const STORAGE_WRITE = -63;
export const STORAGE_REMOVE_DIR = -64;
export const STORAGE_CREATE_DIR = -65;
export const STORAGE_GET_INFO = -66;
export const CONVERT = -80;
export const CONVERT_DOWNLOAD = -81;
export const CONVERT_UNKNOWN_FORMAT = -82;
export const CONVERT_TIMEOUT = -83;
export const CONVERT_READ_FILE = -84;
export const CONVERT_DRM_UNSUPPORTED = -85;
export const CONVERT_CORRUPTED = -86;
export const CONVERT_LIBREOFFICE = -87;
export const CONVERT_PARAMS = -88;
export const CONVERT_NEED_PARAMS = -89;
export const CONVERT_DRM = -90;
export const CONVERT_PASSWORD = -91;
export const CONVERT_ICU = -92;
export const CONVERT_LIMITS = -93;
export const CONVERT_TEMPORARY = -94;
export const CONVERT_DETECT = -95;
export const CONVERT_CELLLIMITS = -96;
export const CONVERT_DEAD_LETTER = -99;
export const UPLOAD = -100;
export const UPLOAD_CONTENT_LENGTH = -101;
export const UPLOAD_EXTENSION = -102;
export const UPLOAD_COUNT_FILES = -103;
export const UPLOAD_URL = -104;
export const VKEY = -120;
export const VKEY_ENCRYPT = -121;
export const VKEY_KEY_EXPIRE = -122;
export const VKEY_USER_COUNT_EXCEED = -123;
export const VKEY_TIME_EXPIRE = -124;
export const VKEY_TIME_INCORRECT = -125;
export const EDITOR_CHANGES = -160;
export const PASSWORD = -180;

//Quorum queues internally only support two priorities: high and normal.
//Messages without a priority set will be mapped to normal as will priorities 0 - 4.
//Messages with a priority higher than 4 will be mapped to high.
export const QUEUE_PRIORITY_VERY_LOW = 2;
export const QUEUE_PRIORITY_LOW = 3;
export const QUEUE_PRIORITY_NORMAL = 4;
export const QUEUE_PRIORITY_HIGH = 5;
export const QUEUE_PRIORITY_VERY_HIGH = 6;

export const EDITOR_TYPE_WORD = 0;
export const EDITOR_TYPE_SPREADSHEET = 1;
export const EDITOR_TYPE_PRESENTATION = 2;
export const EDITOR_TYPE_CONVERTATION = 3;

export const PACKAGE_TYPE_OS = 0;
export const PACKAGE_TYPE_I = 1;
export const PACKAGE_TYPE_D = 2;

export const REDIS_KEY_SHUTDOWN = 'shutdown';
export const REDIS_KEY_LICENSE = 'license';
export const REDIS_KEY_LICENSE_T = 'licenseT';

export const SHUTDOWN_CODE = 4001;
export const SHUTDOWN_REASON = 'server shutdown';
export const SESSION_IDLE_CODE = 4002;
export const SESSION_IDLE_REASON = 'idle session expires';
export const SESSION_ABSOLUTE_CODE = 4003;
export const SESSION_ABSOLUTE_REASON = 'absolute session expires';
export const ACCESS_DENIED_CODE = 4004;
export const ACCESS_DENIED_REASON = 'access deny';
export const JWT_EXPIRED_CODE = 4005;
export const JWT_EXPIRED_REASON = 'token:';
export const JWT_ERROR_CODE = 4006;
export const JWT_ERROR_REASON = 'token:';
export const DROP_CODE = 4007;
export const DROP_REASON = 'drop';
export const UPDATE_VERSION_CODE = 4008;
export const UPDATE_VERSION = 'update version';
export const NO_CACHE_CODE = 4009;
export const NO_CACHE = 'no cache';
export const RESTORE_CODE = 4010;
export const RESTORE = 'no cache';

export const CONTENT_DISPOSITION_INLINE = 'inline';
export const CONTENT_DISPOSITION_ATTACHMENT = 'attachment';

export const CONN_CLOSED = "closed";

export const FILE_STATUS_OK = 'ok';
export const FILE_STATUS_UPDATE_VERSION = 'updateversion';

export const ACTIVEMQ_QUEUE_PREFIX = 'queue://';
export const ACTIVEMQ_TOPIC_PREFIX = 'topic://';

export const TEMPLATES_DEFAULT_LOCALE = 'en-US';
export const TEMPLATES_FOLDER_LOCALE_COLLISON_MAP = {
  'en': 'en-US',
  'pt': 'pt-BR',
  'zh': 'zh-CH',
  'pt-PT': 'pt-PT',
  'zh-TW': 'zh-TW'
};

export const TABLE_RESULT_SCHEMA = [
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

export const TABLE_CHANGES_SCHEMA = [
  'tenant',
  'id',
  'change_id',
  'user_id',
  'user_id_original',
  'user_name',
  'change_data',
  'change_date',
];
