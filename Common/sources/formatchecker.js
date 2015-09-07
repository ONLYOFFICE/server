var CFB = require('cfb');
var path = require('path');
var nodeZip = require('node-zip');
var constants = require('./constants');
var logger = require('./logger');

var mimeMap = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.mht': 'message/rfc822',
  '.epub': 'application/zip',
  '.fb2': 'text/xml',
  '.mobi': 'application/x-mobipocket-ebook',
  '.prc': 'application/x-mobipocket-ebook',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.csv': 'text/csv',
  '.pdf': 'application/pdf',
  '.swf': 'application/x-shockwave-flash',
  '.djvu': 'image/vnd.djvu',
  '.xps': 'application/vnd.ms-xpsdocument',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.json': 'application/json',
  '.ttc': 'application/octet-stream',
  '.otf': 'application/octet-stream',
  '.js': 'application/javascript'
};

function getFileFormatBySignature(buffer) {
  var uint8s = new Uint8Array(buffer);
  var length = uint8s.length;
  var startText = String.fromCharCode.apply(null, uint8s.subarray(0, 20));

  //rtf
  //ASCII: {\rtf
  if (0 == startText.indexOf('{\\rtf')) {
    return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF;
  }

  //pdf
  //ASCII: %PDF-
  if (-1 != startText.indexOf('%PDF-')) {
    return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF;
  } else if (0 == startText.indexOf('DOCY')) {
    return constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD;
  } else if (0 == startText.indexOf('XLSY')) {
    return constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET;
  } else if (0 == startText.indexOf('PPTY')) {
    return constants.AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION;
  }

  var tagOpen = false;
  //FB2 File is XML-file with rootElement - FictionBook
  //Html File is XML-file with rootElement - html
  for (var i = 0; i < length - 11 && i < 100; i++) {
    if (0x3C == uint8s[i]) {
      tagOpen = true;
    } else if (0x3E == uint8s[i]) {
      tagOpen = false;
    } else if (tagOpen && 0x46 == uint8s[i] && 0x69 == uint8s[i + 1] && 0x63 == uint8s[i + 2] &&
      0x74 == uint8s[i + 3] && 0x69 == uint8s[i + 4] && 0x6F == uint8s[i + 5] &&
      0x6E == uint8s[i + 6] && 0x42 == uint8s[i + 7] && 0x6F == uint8s[i + 8] &&
      0x6F == uint8s[i + 9] && 0x6B == uint8s[i + 10]) {
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2;
    } else if (tagOpen && (0x48 == uint8s[i] || 0x68 == uint8s[i]) && (0x54 == uint8s[i + 1] ||
      0x74 == uint8s[i + 1]) && (0x4d == uint8s[i + 2] || 0x6d == uint8s[i + 2]) &&
      (0x4c == uint8s[i + 3] || 0x6c == uint8s[i + 3])) {
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML;
    }
  }

  //djvu
  //Hex: 41 54 26 54 46 4f 52 4d
  //ASCII: AT&TFORM
  if ((8 <= length) && 0x41 == uint8s[0] && 0x54 == uint8s[1] && 0x26 == uint8s[2] && 0x54 == uint8s[3] &&
    0x46 == uint8s[4] && 0x4f == uint8s[5] && 0x52 == uint8s[6] && 0x4d == uint8s[7]) {
    return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU;
  }

  //mobi
  if (68 <= length && (('B' == uint8s[60] && 'O' == uint8s[61] && 'O' == uint8s[62] && 'K' == uint8s[63] &&
    'M' == uint8s[64] && 'O' == uint8s[65] && 'B' == uint8s[66] && 'I' == uint8s[67]) ||
    ('T' == uint8s[60] && 'E' == uint8s[61] && 'X' == uint8s[62] && 't' == uint8s[63] && 'R' == uint8s[64] &&
      'E' == uint8s[65] && 'A' == uint8s[66] && 'd' == uint8s[67]))) {
    return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MOBI;
  }

  //jpeg
  // Hex: FF D8 FF
  if ((3 <= length) && (0xFF == uint8s[0]) && (0xD8 == uint8s[1]) && (0xFF == uint8s[2])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_JPG;
  }

  //bmp ( http://ru.wikipedia.org/wiki/BMP )
  //Hex: 42 4D
  //ASCII: BM
  //Hex (position 6) : 00 00
  //Hex (position 26): 01 00
  //Hex (position 28): 00 || 01 || 04 || 08 || 10 || 18 || 20
  //Hex (position 29): 00
  //Hex (position 30): 00 || 01 || 02 || 03 || 04 || 05
  //Hex (position 31): 00 00 00
  if ((34 <= length) && (0x42 == uint8s[0]) && (0x4D == uint8s[1]) && (0x00 == uint8s[6]) && (0x00 == uint8s[7]) &&
    (0x01 == uint8s[26]) && (0x00 == uint8s[27]) && ((0x00 == uint8s[28]) || (0x01 == uint8s[28]) ||
    (0x04 == uint8s[28]) || (0x08 == uint8s[28]) || (0x10 == uint8s[28]) || (0x18 == uint8s[28]) ||
    (0x20 == uint8s[28])) && (0x00 == uint8s[29]) && ((0x00 == uint8s[30]) || (0x01 == uint8s[30]) ||
    (0x02 == uint8s[30]) || (0x03 == uint8s[30]) || (0x04 == uint8s[30]) || (0x05 == uint8s[30])) &&
    (0x00 == uint8s[31]) && (0x00 == uint8s[32]) && (0x00 == uint8s[33])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_BMP;
  }

  //gif
  //Hex: 47 49 46 38
  //ASCII: GIF8
  //or for GIF87a...
  //Hex: 47 49 46 38 37 61
  //ASCII: GIF87a
  //or for GIF89a...
  //Hex: 47 49 46 38 39 61
  //ASCII: GIF89a
  if (0 == startText.indexOf('GIF8')) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_GIF;
  }
  if (0 == startText.indexOf('GIF87a') || 0 == startText.indexOf('GIF89a')) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_GIF;
  }

  //png
  //Hex: 89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52
  //ASCII: .PNG........IHDR
  if ((16 <= length) && (0x89 == uint8s[0]) && (0x50 == uint8s[1]) && (0x4E == uint8s[2]) && (0x47 == uint8s[3]) &&
    (0x0D == uint8s[4]) && (0x0A == uint8s[5]) && (0x1A == uint8s[6]) && (0x0A == uint8s[7]) &&
    (0x00 == uint8s[8]) && (0x00 == uint8s[9]) && (0x00 == uint8s[10]) && (0x0D == uint8s[11]) &&
    (0x49 == uint8s[12]) && (0x48 == uint8s[13]) && (0x44 == uint8s[14]) && (0x52 == uint8s[15])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PNG;
  }

  //CR2
  //Hex: 49 49 2A 00 10 00 00 00 43 52
  //ASCII: II*.....CR
  if ((10 <= length) && (0x49 == uint8s[0]) && (0x49 == uint8s[1]) && (0x2A == uint8s[2]) &&
    (0x00 == uint8s[3]) && (0x10 == uint8s[4]) && (0x00 == uint8s[5]) && (0x00 == uint8s[6]) &&
    (0x00 == uint8s[7]) && (0x43 == uint8s[8]) && (0x52 == uint8s[9])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_CR2;
  }

  //tiff
  //Hex: 49 49 2A 00
  //ASCII:
  //or for big endian
  //Hex: 4D 4D 00 2A
  //ASCII: MM.*
  //or for little endian
  //Hex: 49 49 2A 00
  //ASCII: II*
  if (4 <= length) {
    if (((0x49 == uint8s[0]) && (0x49 == uint8s[1]) && (0x2A == uint8s[2]) && (0x00 == uint8s[3])) ||
      ((0x4D == uint8s[0]) && (0x4D == uint8s[1]) && (0x00 == uint8s[2]) && (0x2A == uint8s[3])) ||
      ((0x49 == uint8s[0]) && (0x49 == uint8s[1]) && (0x2A == uint8s[2]) && (0x00 == uint8s[3]))) {
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_TIFF;
    }
  }

  //wmf
  //Hex: D7 CD C6 9A 00 00
  //or for Windows 3.x
  //Hex: 01 00 09 00 00 03
  if (6 <= length) {
    if (((0xD7 == uint8s[0]) && (0xCD == uint8s[1]) && (0xC6 == uint8s[2]) && (0x9A == uint8s[3]) &&
      (0x00 == uint8s[4]) && (0x00 == uint8s[5])) || ((0x01 == uint8s[0]) && (0x00 == uint8s[1]) &&
      (0x09 == uint8s[2]) && (0x00 == uint8s[3]) && (0x00 == uint8s[4]) && (0x03 == uint8s[5]))) {
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_WMF;
    }
  }

  //emf ( http://wvware.sourceforge.net/caolan/ora-wmf.html )
  //Hex: 01 00 00 00
  //Hex (position 40): 20 45 4D 46
  if ((44 <= length) && (0x01 == uint8s[0]) && (0x00 == uint8s[1]) && (0x00 == uint8s[2]) && (0x00 == uint8s[3]) &&
    (0x20 == uint8s[40]) && (0x45 == uint8s[41]) && (0x4D == uint8s[42]) && (0x46 == uint8s[43])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_EMF;
  }

  //pcx ( http://www.fileformat.info/format/pcx/corion.htm )
  //Hex (position 0): 0A
  //Hex (position 1): 00 || 01 || 02 || 03 || 04 || 05
  //Hex (position 3): 01 || 02 || 04 || 08 ( Bytes per pixel )
  if ((4 <= length) && (0x0A == uint8s[0]) && (0x00 == uint8s[1] || 0x01 == uint8s[1] ||
    0x02 == uint8s[1] || 0x03 == uint8s[1] || 0x04 == uint8s[1] || 0x05 == uint8s[1]) &&
    (0x01 == uint8s[3] || 0x02 == uint8s[3] || 0x04 == uint8s[3] || 0x08 == uint8s[3])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PCX;
  }

  //tga ( http://www.fileformat.info/format/tga/corion.htm )
  //DATA TYPE 1-COLOR-MAPPED IMAGES								: Hex (position 1) : 01 01
  //DATA TYPE 2-TRUE-COLOR IMAGES									: Hex (position 1) : 00 02
  //DATA TYPE 3-BLACK AND WHITE(UNMAPPED) IMAGES					: Hex (position 1) : 00 03
  //DATA TYPE 9-RUN-LENGTH ENCODED(RLE),COLOR-MAPPED IMAGES		: Hex (position 1) : 01 09
  //DATA TYPE 10-RUN-LENGTH ENCODED(RLE),TRUE-COLOR IMAGES		: Hex (position 1) : 00 0A
  //DATA TYPE 11-RUN-LENGTH ENCODED(RLE),BLACK AND WHITE IMAGES	: Hex (position 1) : 00 0B
  // + Bytes per pixel											: Hex (position 16): 0x08 || 0x10 || 0x18 || 0x20
  if ((17 <= length) && ((0x01 == uint8s[1] && 0x01 == uint8s[2]) || (0x00 == uint8s[1] && 0x02 == uint8s[2]) ||
    (0x00 == uint8s[1] && 0x03 == uint8s[2]) || (0x01 == uint8s[1] && 0x09 == uint8s[2]) ||
    (0x00 == uint8s[1] && 0x0A == uint8s[2]) || (0x00 == uint8s[1] && 0x0B == uint8s[2])) &&
    (0x08 == uint8s[16] || 0x10 == uint8s[16] || 0x18 == uint8s[16] || 0x20 == uint8s[16])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_TGA;
  }

  //ras
  //Hex: 59 A6 6A 95
  //ASCII: Y
  if ((4 <= length) && (0x59 == uint8s[0]) && (0xA6 == uint8s[1]) && (0x6A == uint8s[2]) && (0x95 == uint8s[3])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_RAS;
  }

  //ipod
  //(None or Unknown)

  //psd
  //Hex: 38 42 50 53 00 01 00 00 00 00 00 00 00
  //ASCII: 8BPS
  if ((13 <= length) && (0x38 == uint8s[0]) && (0x42 == uint8s[1]) && (0x50 == uint8s[2]) &&
    (0x53 == uint8s[3]) && (0x00 == uint8s[4]) && (0x01 == uint8s[5]) && (0x00 == uint8s[6]) &&
    (0x00 == uint8s[7]) && (0x00 == uint8s[8]) && (0x00 == uint8s[9]) && (0x00 == uint8s[10]) &&
    (0x00 == uint8s[11]) && (0x00 == uint8s[12])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PSD;
  }

  //ico
  //Hex: 00 00 01 00
  if (4 <= length && 0x00 == uint8s[0] && 0x00 == uint8s[1] && 0x01 == uint8s[2] && 0x00 == uint8s[3]) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_ICO;
  }

  //svg
  //работает для svg сделаных в редакторе, внешние svg могуть быть с пробелами в начале
  if (0 == startText.indexOf('<svg')) {
    return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG;
  }

  return constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
}
function getFileFormatByZip(buffer) {
  try {
    var zip = new nodeZip(buffer);
    var zipObject;
    var zipText;
    zipObject = zip.file('[Content_Types].xml');
    if (zipObject) {
      zipText = zipObject.asText();
      if (-1 != zipText.indexOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') ||
        -1 != zipText.indexOf('application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml') ||
        -1 != zipText.indexOf('application/vnd.ms-word.document.macroEnabled.main+xml') ||
        -1 != zipText.indexOf('application/vnd.ms-word.template.macroEnabledTemplate.main+xml')) {
        return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX;
      } else if (-1 != zipText.indexOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml') ||
        -1 != zipText.indexOf('application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml') ||
        -1 != zipText.indexOf('application/vnd.ms-excel.sheet.macroEnabled.main+xml') ||
        -1 != zipText.indexOf('application/vnd.ms-excel.template.macroEnabled.main+xml')) {
        return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX;
      } else if (-1 != zipText.indexOf('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml') ||
        -1 != zipText.indexOf('application/vnd.openxmlformats-officedocument.presentationml.template.main+xml') ||
        -1 != zipText.indexOf('application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml') ||
        -1 != zipText.indexOf('application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml') ||
        -1 != zipText.indexOf('application/vnd.ms-powerpoint.template.macroEnabled.main+xml')) {
        return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX;
      } else if (-1 != zipText.indexOf('application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml')) {
        return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX;
      }
    }
    zipObject = zip.file('mimetype');
    if (zipObject) {
      zipText = zipObject.asText();
      if (-1 != zipText.indexOf('application/vnd.oasis.opendocument.text')) {
        return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT;
      } else if (-1 != zipText.indexOf('application/vnd.oasis.opendocument.spreadsheet')) {
        return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS;
      } else if (-1 != zipText.indexOf('application/vnd.oasis.opendocument.presentation')) {
        return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP;
      } else if (-1 != zipText.indexOf('application/epub+zip')) {
        return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB;
      }
    }
    zipObject = zip.file('_rels/.rels');
    if (zipObject) {
      zipText = zipObject.asText();
      if (-1 != zipText.indexOf('http://schemas.microsoft.com/xps/2005/06/fixedrepresentation')) {
        return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS;
      }
    }
    zipObject = zip.file('_rels/.rels/[0].piece');
    if (zipObject) {
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS;
    }
    zipObject = zip.file('Editor.bin');
    if (zipObject) {
      var zipBin = zipObject.asUint8Array();
      var startText = String.fromCharCode.apply(null, zipBin.subarray(0, 4));
      switch (startText) {
        case 'DOCY':
          return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_DOCY;
          break;
        case 'XLSY':
          return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY;
          break;
        case 'PPTY':
          return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY;
          break;
      }
    }
    zipObject = zip.file('Editor.xml');
    if (zipObject) {
      return constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_PRESENTATION;
    }
    zipObject = zip.file('Editor.svg');
    if (zipObject) {
      return constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_DRAWING;
    }
    zipObject = zip.file('Editor.html.arch');
    if (zipObject) {
      return constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_DOCUMENT;
    }
  }
  catch (e) {
  }
  return constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
}
function getconstantstorage(uint8s) {
  try {
    var cfb = CFB.parse(uint8s);
    if (cfb.find('WordDocument')) {
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC;
    }
    if (cfb.find('Workbook')) {
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS;
    }
    if (cfb.find('PowerPoint Document')) {
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT;
    }
    if (cfb.find('PowerPoint Document')) {
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT;
    }
    if (cfb.find('\u0006DataSpaces')) {
      return constants.AVS_OFFICESTUDIO_FILE_OTHER_MS_OFFCRYPTO;
    }
  }
  catch (e) {
  }
  return constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
}
exports.getFormatFromString = function(ext) {
  switch (ext.toLowerCase()) {
    case 'docx':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX;
    case 'doc':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC;
    case 'odt':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT;
    case 'rtf':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF;
    case 'txt':
    case 'xml':
    case 'xslt':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT;
    case 'htm':
    case 'html':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML;
    case 'mht':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MHT;
    case 'epub':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB;
    case 'fb2':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2;
    case 'mobi':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MOBI;

    case 'pptx':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX;
    case 'ppt':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT;
    case 'odp':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP;
    case 'ppsx':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX;

    case 'xlsx':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX;
    case 'xls':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS;
    case 'ods':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS;
    case 'csv':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV;

    case 'jpeg':
    case 'jpe':
    case 'jpg':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_JPG;
    case 'tif':
    case 'tiff':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_TIFF;
    case 'tga':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_TGA;
    case 'gif':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_GIF;
    case 'png':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PNG;
    case 'emf':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_EMF;
    case 'wmf':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_WMF;
    case 'bmp':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_BMP;
    case 'cr2':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_CR2;
    case 'pcx':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PCX;
    case 'ras':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_RAS;
    case 'psd':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PSD;
    case 'ico':
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_ICO;

    case 'pdf':
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF;
    case 'swf':
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SWF;
    case 'djvu':
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU;
    case 'xps':
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS;
    case 'svg':
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG;
    case 'htmlr':
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR;
    case 'doct':
      return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_DOCY;
    case 'xlst':
      return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY;
    case 'pptt':
      return constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY;
    default:
      return constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
  }
};
exports.getStringFromFormat = function(format) {
  switch (format) {
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX:
      return 'docx';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC:
      return 'doc';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT:
      return 'odt';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF:
      return 'rtf';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT:
      return 'txt';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML:
      return 'html';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MHT:
      return 'mht';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB:
      return 'epub';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2:
      return 'fb2';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MOBI:
      return 'mobi';

    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX:
      return 'pptx';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT:
      return 'ppt';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP:
      return 'odp';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX:
      return 'ppsx';

    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX:
      return 'xlsx';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS:
      return 'xls';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS:
      return 'ods';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV:
      return 'csv';

    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF:
      return 'pdf';
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SWF:
      return 'swf';
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU:
      return 'djvu';
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS:
      return 'xps';
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG:
      return 'svg';
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_HTMLR:
      return 'htmlr';

    case constants.AVS_OFFICESTUDIO_FILE_OTHER_HTMLZIP:
      return 'zip';
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_JSON:
      return 'json';

    case constants.AVS_OFFICESTUDIO_FILE_IMAGE:
      return 'jpg';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_JPG:
      return 'jpg';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_TIFF:
      return 'tiff';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_TGA:
      return 'tga';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_GIF:
      return 'gif';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_PNG:
      return 'png';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_EMF:
      return 'emf';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_WMF:
      return 'wmf';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_BMP:
      return 'bmp';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_CR2:
      return 'cr2';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_PCX:
      return 'pcx';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_RAS:
      return 'ras';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_PSD:
      return 'psd';
    case constants.AVS_OFFICESTUDIO_FILE_IMAGE_ICO:
      return 'ico';

    case constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD:
    case constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET:
    case constants.AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION:
      return 'bin';
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_DOCUMENT:
    case constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_DOCY:
      return 'doct';
    case constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY:
      return 'xlst';
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_PRESENTATION:
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_OLD_DRAWING:
    case constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY:
      return 'pptt';
    default:
      return '';
  }
};
exports.getFileFormat = function(buffer, optExt) {
  var format = constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
  try {
    if (0 == buffer.length) {
      format = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT;
    } else {
      //zip
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN == format) {
        format = getFileFormatByZip(buffer);
      }
      //compound files
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN == format) {
        format = getconstantstorage(buffer);
      }
      //меняем местами getFileFormatBySignature и getFileFormatByZip(epub распознается как html)
      //signature
      format = getFileFormatBySignature(buffer);
      //возвращаем тип по расширению
      if (constants.AVS_OFFICESTUDIO_FILE_UNKNOWN == format && optExt) {
        if ('.mht' == optExt) {
          format = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MHT;
        } else if ('.txt' == optExt || '.xml' == optExt || '.xslt' == optExt) {
          format = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT;
        } else if ('.csv' == optExt) {
          format = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV;
        } else if ('.svg' == optExt) {
          format = constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG;
        } else if ('.html' == optExt || '.htm' == optExt) {
          format = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML;
        } else {
          //пробуем по расширению
          if (optExt.Length > 0 && '.' == optExt[0]) {
            optExt = optExt.substring(1);
          }
          format = exports.getFormatFromString(optExt);
        }
      }
    }
  }
  catch (e) {
    logger.error(optExt);
    logger.error('error getFileFormat:\r\n%s', e.stack);
  }
  return format;
};
exports.getMimeType = function(strPath) {
  return mimeMap[path.extname(strPath)] || 'application/octet-stream';
};
