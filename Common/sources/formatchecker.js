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

var path = require('path');
var constants = require('./constants');
const fs = require('fs');
const CFB = require('cfb');

function getImageFormatBySignature(buffer) {
  var length = buffer.length;
  //1000 for svg(xml header and creator comment)
  var startText = buffer.toString('ascii', 0, 1000);

  //jpeg
  // Hex: FF D8 FF
  if ((3 <= length) && (0xFF == buffer[0]) && (0xD8 == buffer[1]) && (0xFF == buffer[2])) {
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
  if ((34 <= length) && (0x42 == buffer[0]) && (0x4D == buffer[1]) && (0x00 == buffer[6]) && (0x00 == buffer[7]) &&
    (0x01 == buffer[26]) && (0x00 == buffer[27]) && ((0x00 == buffer[28]) || (0x01 == buffer[28]) ||
    (0x04 == buffer[28]) || (0x08 == buffer[28]) || (0x10 == buffer[28]) || (0x18 == buffer[28]) ||
    (0x20 == buffer[28])) && (0x00 == buffer[29]) && ((0x00 == buffer[30]) || (0x01 == buffer[30]) ||
    (0x02 == buffer[30]) || (0x03 == buffer[30]) || (0x04 == buffer[30]) || (0x05 == buffer[30])) &&
    (0x00 == buffer[31]) && (0x00 == buffer[32]) && (0x00 == buffer[33])) {
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
  if ((16 <= length) && (0x89 == buffer[0]) && (0x50 == buffer[1]) && (0x4E == buffer[2]) && (0x47 == buffer[3]) &&
    (0x0D == buffer[4]) && (0x0A == buffer[5]) && (0x1A == buffer[6]) && (0x0A == buffer[7]) &&
    (0x00 == buffer[8]) && (0x00 == buffer[9]) && (0x00 == buffer[10]) && (0x0D == buffer[11]) &&
    (0x49 == buffer[12]) && (0x48 == buffer[13]) && (0x44 == buffer[14]) && (0x52 == buffer[15])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PNG;
  }

  //CR2
  //Hex: 49 49 2A 00 10 00 00 00 43 52
  //ASCII: II*.....CR
  if ((10 <= length) && (0x49 == buffer[0]) && (0x49 == buffer[1]) && (0x2A == buffer[2]) &&
    (0x00 == buffer[3]) && (0x10 == buffer[4]) && (0x00 == buffer[5]) && (0x00 == buffer[6]) &&
    (0x00 == buffer[7]) && (0x43 == buffer[8]) && (0x52 == buffer[9])) {
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
    if (((0x49 == buffer[0]) && (0x49 == buffer[1]) && (0x2A == buffer[2]) && (0x00 == buffer[3])) ||
      ((0x4D == buffer[0]) && (0x4D == buffer[1]) && (0x00 == buffer[2]) && (0x2A == buffer[3])) ||
      ((0x49 == buffer[0]) && (0x49 == buffer[1]) && (0x2A == buffer[2]) && (0x00 == buffer[3]))) {
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_TIFF;
    }
  }

  //wmf
  //Hex: D7 CD C6 9A 00 00
  //or for Windows 3.x
  //Hex: 01 00 09 00 00 03
  if (6 <= length) {
    if (((0xD7 == buffer[0]) && (0xCD == buffer[1]) && (0xC6 == buffer[2]) && (0x9A == buffer[3]) &&
      (0x00 == buffer[4]) && (0x00 == buffer[5])) || ((0x01 == buffer[0]) && (0x00 == buffer[1]) &&
      (0x09 == buffer[2]) && (0x00 == buffer[3]) && (0x00 == buffer[4]) && (0x03 == buffer[5]))) {
      return constants.AVS_OFFICESTUDIO_FILE_IMAGE_WMF;
    }
  }

  //emf ( http://wvware.sourceforge.net/caolan/ora-wmf.html )
  //Hex: 01 00 00 00
  //Hex (position 40): 20 45 4D 46
  if ((44 <= length) && (0x01 == buffer[0]) && (0x00 == buffer[1]) && (0x00 == buffer[2]) && (0x00 == buffer[3]) &&
    (0x20 == buffer[40]) && (0x45 == buffer[41]) && (0x4D == buffer[42]) && (0x46 == buffer[43])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_EMF;
  }

  //pcx ( http://www.fileformat.info/format/pcx/corion.htm )
  //Hex (position 0): 0A
  //Hex (position 1): 00 || 01 || 02 || 03 || 04 || 05
  //Hex (position 3): 01 || 02 || 04 || 08 ( Bytes per pixel )
  if ((4 <= length) && (0x0A == buffer[0]) && (0x00 == buffer[1] || 0x01 == buffer[1] ||
    0x02 == buffer[1] || 0x03 == buffer[1] || 0x04 == buffer[1] || 0x05 == buffer[1]) &&
    (0x01 == buffer[3] || 0x02 == buffer[3] || 0x04 == buffer[3] || 0x08 == buffer[3])) {
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
  if ((17 <= length) && ((0x01 == buffer[1] && 0x01 == buffer[2]) || (0x00 == buffer[1] && 0x02 == buffer[2]) ||
    (0x00 == buffer[1] && 0x03 == buffer[2]) || (0x01 == buffer[1] && 0x09 == buffer[2]) ||
    (0x00 == buffer[1] && 0x0A == buffer[2]) || (0x00 == buffer[1] && 0x0B == buffer[2])) &&
    (0x08 == buffer[16] || 0x10 == buffer[16] || 0x18 == buffer[16] || 0x20 == buffer[16])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_TGA;
  }

  //ras
  //Hex: 59 A6 6A 95
  //ASCII: Y
  if ((4 <= length) && (0x59 == buffer[0]) && (0xA6 == buffer[1]) && (0x6A == buffer[2]) && (0x95 == buffer[3])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_RAS;
  }

  //ipod
  //(None or Unknown)

  //psd
  //Hex: 38 42 50 53 00 01 00 00 00 00 00 00 00
  //ASCII: 8BPS
  if ((13 <= length) && (0x38 == buffer[0]) && (0x42 == buffer[1]) && (0x50 == buffer[2]) &&
    (0x53 == buffer[3]) && (0x00 == buffer[4]) && (0x01 == buffer[5]) && (0x00 == buffer[6]) &&
    (0x00 == buffer[7]) && (0x00 == buffer[8]) && (0x00 == buffer[9]) && (0x00 == buffer[10]) &&
    (0x00 == buffer[11]) && (0x00 == buffer[12])) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_PSD;
  }

  //ico
  //Hex: 00 00 01 00
  if (4 <= length && 0x00 == buffer[0] && 0x00 == buffer[1] && 0x01 == buffer[2] && 0x00 == buffer[3]) {
    return constants.AVS_OFFICESTUDIO_FILE_IMAGE_ICO;
  }

  //svg
  //todo sax parser
  if (-1 !== startText.indexOf('<svg')) {
    return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_SVG;
  }

  return constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
}
function getCompoundBinaryFile(buffer) {
  let cfb;
  try {
    cfb = CFB.read(buffer, { type: 'buffer' });
  } catch (error) {
    return null;
  }
  return cfb;
}
function isDocFormatFile(buffer) {
  const cfb = getCompoundBinaryFile(buffer);
  if (cfb === null) return false;

  //ms office 2007 encrypted contains stream WordDocument !!
  const dataSpacesEntry = CFB.find(cfb, 'DataSpaces');
  if (dataSpacesEntry !== null) {
    return false;
  }

  const storage = CFB.find(cfb, 'WordDocument');
  if (storage === null) {
    return false;
  }
  const { content } = storage;
  if ((content[0] === 0xEC && content[1] === 0xA5) ||		// word 1997-2003
			(content[0] === 0xDC && content[1] === 0xA5) ||		// word 1995
			(content[0] === 0xDB && content[1] === 0xA5))	
		{
			return true;
		}
  if (isHtmlFormatFile(buffer)) {
    return true;
  }
  return false;
}
function isHtmlFormatFile(buffer) {
  if (buffer.length > 5) {
    for (let i = 0; i < buffer.length - 6; i++) {
      if (buffer[i] === 0x3C && buffer[i + 1] === 0x2F && (buffer[i + 2] === 0x48 || buffer[i + 2] === 0x68) &&
        (buffer[i + 3] === 0x54 || buffer[i + 3] === 0x74) && (buffer[i + 4] === 0x4d || buffer[i + 4] === 0x6d) &&
        (buffer[i + 5] === 0x4c || buffer[i + 5] === 0x6c)) {
        return true;
      } else if ((buffer[i] === 0x3C) && (buffer[i + 1] === 0x2F) && (buffer[i + 2] === 0x62) && (buffer[i + 3] === 0x6f) &&
         (buffer[i + 4] === 0x64) && (buffer[i + 5] === 0x79) && (buffer[i + 6] === 0x3e)) {
        // </body>
        return true;
      }
    }
  }
  if (buffer.length > 3) {
    // If `testCloseTag` is false or the buffer is less than 6 bytes, check for an opening HTML tag.
    for (let i = 0; i < buffer.length - 4 && i < 100; i++) {
      if ((buffer[i] === 0x48 || buffer[i] === 0x68) && (buffer[i + 1] === 0x54 || buffer[i + 1] === 0x74) &&
        (buffer[i + 2] === 0x4d || buffer[i + 2] === 0x6d) && (buffer[i + 3] === 0x4c || buffer[i + 3] === 0x6c)) {
        return true;
      }
    }
  }
  return false;
}
function isXlsFormatFile(buffer) {
  const cfb = getCompoundBinaryFile(buffer);
  if (cfb === null) return false;
  const Workbook = CFB.find(cfb, 'Workbook');
  const Book = CFB.find(cfb, 'Book');
  const WORKBOOK = CFB.find(cfb, 'WORKBOOK');
  const BOOK = CFB.find(cfb, 'BOOK');
  const book = CFB.find(cfb, 'book');
  if (Workbook === null && Book === null && WORKBOOK === null && BOOK === null && book === null) {
    return false;
  }

  if (Workbook.content !== null || Book.content !== null || WORKBOOK.content !== null ||
    BOOK.content !== null || book.content !== null) {
    return true;
  }
  return false;
}
function isPptFormatFile(buffer) {
  const cfb = getCompoundBinaryFile(buffer);
  if (cfb === null) return false;
  const storage = CFB.find(cfb, 'PowerPoint Document');
  if (storage === null) {
    return false;
  }
  return true;
}
function isMsOfficeCryptoFormatFile(buffer) {
  const cfb = getCompoundBinaryFile(buffer);
  if (cfb === null) return false;
  const dataSpace = CFB.find(cfb, '\x06DataSpaces');
  if (dataSpace === null) {
    return false;
  }
  const encryptedInfo = CFB.find(cfb, 'EncryptionInfo');
  if (encryptedInfo === null) {
    return false;
  }
  return true;
}
function isMsMitCryptoFormatFile(buffer) {
  const cfb = getCompoundBinaryFile(buffer);
  if (cfb === null) return false;
  const dataSpace = CFB.find(cfb, '\x06DataSpaces');
  if (dataSpace === null) {
    return false;
  }
  const encryptedInfo = CFB.find(cfb, 'EncryptionInfo');
  const encryptedPackage = CFB.find(cfb, 'EncryptedPackage');
  if (encryptedInfo === null || encryptedPackage === null) {
    return false;
  }
  return true;
}
function isOpenOfficeFormatFile(buffer) {
  const cfb = getCompoundBinaryFile(buffer);
  if (cfb === null) return false;
  let fileFormat;
  const odtFormatLine = "application/vnd.oasis.opendocument.text";
  const odsFormatLine = "application/vnd.oasis.opendocument.spreadsheet";
  const odpFormatLine = "application/vnd.oasis.opendocument.presentation";
	const ottFormatLine = "application/vnd.oasis.opendocument.text-template";
	const otsFormatLine = "application/vnd.oasis.opendocument.spreadsheet-template";
 	const otpFormatLine = "application/vnd.oasis.opendocument.presentation-template";
	const epubFormatLine = "application/epub+zip";
	const sxwFormatLine = "application/vnd.sun.xml.writer";
	const sxcFormatLine = "application/vnd.sun.xml.calc";
	const sxiFormatLine = "application/vnd.sun.xml.impress";

  const mimeType = CFB.find(cfb, 'mimetype');
  if (mimeType === null) {
    return false;
  }
  const { content } = mimeType;
  const ascii = Buffer.from(content).toString('ascii');

  if (ascii.includes(ottFormatLine)) {
    fileFormat = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT;
  } else if (ascii.includes(otsFormatLine)) {
    fileFormat = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS;
  } else if (ascii.includes(otpFormatLine)) {
    fileFormat = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP;
  } else if (ascii.includes(odtFormatLine) || ascii.includes(sxwFormatLine)) {
    fileFormat = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT;
  } else if (ascii.includes(odsFormatLine) || ascii.includes(sxcFormatLine)) {
    fileFormat = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS;
  } else if (ascii.includes(odpFormatLine) || ascii.includes(sxiFormatLine)) {
    fileFormat = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP;
  } else if (ascii.includes(epubFormatLine)) {
    fileFormat = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB;
  }

  if (fileFormat !== undefined) return { check: true, format: fileFormat };

  return false;
}
function isOOXFormatFile(buffer) {
  const cfb = getCompoundBinaryFile(buffer);
  if (cfb === null) return false;
  let formatFile;
  const contentTypesXml = CFB.find(cfb, '[Content_Types].xml');
  if (contentTypesXml === null) return false;
  const { content } = contentTypesXml;
  const ascii = Buffer.from(content).toString('ascii');

  const docxFormatLine = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
  const dotxFormatLine = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
  const docmFormatLine = "application/vnd.ms-word.document.macroEnabled.main+xml";
  const dotmFormatLine = "application/vnd.ms-word.template.macroEnabledTemplate.main+xml";
  const oformFormatLine = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.oform";
  const docxfFormatLine = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.docxf";

  const xlsxFormatLine = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  const xltxFormatLine = "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml";
  const xlsmFormatLine = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
  const xltmFormatLine = "application/vnd.ms-excel.template.macroEnabled.main+xml";
  const xlsbFormatLine = "application/vnd.ms-excel.sheet.binary.macroEnabled.main";

  const pptxFormatLine = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
  const ppsxFormatLine = "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml";
  const potxFormatLine = "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml";
  const pptmFormatLine = "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml";
  const ppsmFormatLine = "application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml";
  const potmFormatLine = "application/vnd.ms-powerpoint.template.macroEnabled.main+xml";

  if (ascii.includes(oformFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM;
  } else if (ascii.includes(docxfFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF;
  } else if (ascii.includes(docxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX;
  } else if (ascii.includes(docmFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM;
  } else if (ascii.includes(dotxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX;
  } else if (ascii.includes(dotmFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM;
  } 
  else if (ascii.includes(xlsxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX;
  } else if (ascii.includes(xltxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX;
  } else if (ascii.includes(xlsmFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM;
  } else if (ascii.includes(xltmFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM;
  } else if (ascii.includes(xlsbFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB;
  } else if (ascii.includes(pptxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX;
  } else if (ascii.includes(ppsxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM;
  } else if (ascii.includes(potxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX;
  } else if (ascii.includes(pptmFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM;
  } else if (ascii.includes(ppsmFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM;
  } else if (ascii.includes(potmFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM;
  }
  if (formatFile !== undefined) return { check: true, format: formatFile };
  return false;
}
function isXpsFormatFile(buffer) {
  const cfb = getCompoundBinaryFile(buffer);
  if (cfb === null) return false;
  let formatFile;

  const rels = CFB.find(cfb, '.rels');
  if (rels !== null) {
    const { content } = rels;
    const ascii = Buffer.from(content).toString('ascii');
  
    if (ascii.includes('fixedrepresentation') && (ascii.includes('/xps/') || ascii.includes('/oxps'))) {
      formatFile = constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS;
    }
  } else {
    const relsPiece = CFB.find(cfb, '_rels/.rels/[0].piece');
    if (relsPiece !== null) {
      formatFile = constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS;
    }
  }
  if (formatFile !== undefined) return { check: true, format: formatFile };
  
  return false;
}
function isPdfFormatFile(buffer) {
  const firstLine = buffer.slice(0, buffer.indexOf('\n'));
  const firstMatch = firstLine.toString('ascii').indexOf("%PDF-");
  
  if (firstMatch != -1) {
    return true;
  }

  return false;
}
function isOOXFlatFormatFile(buffer) {
  const ascii = Buffer.from(buffer).toString('ascii');
  let formatFile;
  const docxFormatLine = "xmlns:w=\"http://schemas.microsoft.com/office/word/2003/wordml\"";
  const xlsxFormatLine = "xmlns:ss=\"urn:schemas-microsoft-com:office:spreadsheet\"";
	const docxPackage = "progid=\"Word.Document\"";
	const xlsxPackage = "progid=\"Excel.Sheet\"";
	const pptxPackage = "progid=\"PowerPoint.Show\"";
	const packageFormatLine = "xmlns:pkg=\"http://schemas.microsoft.com/office/2006/xmlPackage\"";

  if (ascii.includes(docxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT;
  } else if (ascii.includes(xlsxFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_FLAT;
  } else if (ascii.includes(packageFormatLine)) {
    if (ascii.includes(docxPackage)) {
      formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_PACKAGE;
    } else if (ascii.includes(xlsxPackage)) {
      formatFile = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_PACKAGE;
    } else if (ascii.includes(pptxPackage)) {
      formatFile = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX_PACKAGE;
    }
  }
  if (formatFile !== undefined) return { check: true, format: formatFile };

  return false;
}
function isOpenOfficeFlatFormatFile(buffer) {
  const ascii = Buffer.from(buffer).toString('ascii');
  let formatFile;
  const odfFormatLine1 = "office:document";
	const odfFormatLine2 = "xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\"";

  if (!ascii.includes(odfFormatLine1) || !ascii.includes(odfFormatLine2)) {
    return false;
  }

  const odtFormatLine = "application/vnd.oasis.opendocument.text";
	const odsFormatLine = "application/vnd.oasis.opendocument.spreadsheet";
	const odpFormatLine = "application/vnd.oasis.opendocument.presentation";

  if (ascii.includes(odtFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT;
  } else if (ascii.includes(odsFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT;
  } else if (ascii.includes(odpFormatLine)) {
    formatFile = constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP_FLAT;
  }
  if (formatFile !== undefined) return { check: true, format: formatFile };

  return false;
}
function isBinaryDoctFormatFile(buffer) {
  const ascii = Buffer.from(buffer).toString('ascii');
  if (ascii[0] === 'D' && ascii[1] === 'O' && ascii[2] === 'C' && ascii[3] === 'Y') {
    return true;
  }
  return false;
}
function isBinaryXlstFormatFile(buffer) {
  const ascii = Buffer.from(buffer).toString('ascii');
  if (ascii[0] === 'X' && ascii[1] === 'L' && ascii[2] === 'S' && ascii[3] === 'Y') {
    return true;
  }
  return false;
}
function isBinaryPpttFormatFile(buffer) {
  const ascii = Buffer.from(buffer).toString('ascii');
  if ('P' === ascii[0] && 'P' === ascii[1] && 'T' === ascii[2] && 'Y' === ascii[3]) {
    return true; 
  }
  return false;
}
function isRtfFormatFile(buffer) {
  const ascii = Buffer.from(buffer).toString('ascii');
  if (ascii[0] === '{' && ascii[1] === '\\' && ascii[2] === 'r' && ascii[3] === 't' && ascii[4] === 'f') {
    return true;
  }
  return false;
}
function isFb2FormatFile(buffer) {
  let tagOpen = false;
  // FB2 File is XML-file with rootElement - FictionBook
  for (let i = 0; i < buffer.length - 11 && i < 100; i++) {
    if (buffer[i] === 0x3C) {
      tagOpen = true;
    } else if (buffer[i] === 0x3E) {
      tagOpen = false;
    } else if (tagOpen && buffer[i] === 0x46 && buffer[i + 1] === 0x69 && buffer[i + 2] === 0x63
      && buffer[i + 3] === 0x74 && buffer[i + 4] === 0x69 && buffer[i + 5] === 0x6F
      && buffer[i + 6] === 0x6E && buffer[i + 7] === 0x42 && buffer[i + 8] === 0x6F
      && buffer[i + 9] === 0x6F && buffer[i + 10] === 0x6B) {
      return true;
    }
  }

  return false;
}

exports.getDocumentFormatByByte = function getDocumentFormatByByte(buffer) {
  // Check for DOC format
  if (isDocFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC;
  }

  // Check format Xls document
  if (isXlsFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS;
  }

  // Check for Ppt format
  if (isPptFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT;
  }

  // Check for Office Crypto crypto format
  if (isMsOfficeCryptoFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_OTHER_MS_OFFCRYPTO;
  }

  // Check for Mit Crypto Office crypto format
  if (isMsMitCryptoFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_OTHER_MS_MITCRYPTO;
  }

  // Check for OOX format
  const ooxFormat = isOOXFormatFile(buffer);
  if (ooxFormat.check) {
    return ooxFormat.format;
  }

  // Check for Open Office format
  const openOfficeFormat = isOpenOfficeFormatFile(buffer);
  if (openOfficeFormat.check) {
    return openOfficeFormat.format;
  }

  // Check for Xps format
  if (isXpsFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_XPS;
  }

  // Check for binary DOCT format.
  if (isBinaryDoctFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD;
  }

  // Check for binary XLST format
  if (isBinaryXlstFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET;
  }

  //Check for binary PPTT format
  if (isBinaryPpttFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT; 
  }

  // Check for OXX flat format
  const ooXFlatFormat = isOOXFlatFormatFile(buffer);
  if (ooXFlatFormat.check) {
    return ooXFlatFormat.format;
  }

  // Check for RTF format.
  if (isRtfFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF;
  }

  // Check for PDF format
  if (isPdfFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF;
  }

  // Check for Djvu format
  if (buffer[0] === 0x41 || buffer[1] === 0x54 || buffer[2] === 0x26 || buffer[3] === 0x54 ||
      buffer[4] === 0x46 || buffer[5] === 0x4F || buffer[6] === 0x52 || buffer[7] === 0x4D) {
    return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_DJVU;
  }

  // Check for Html format
  if (isHtmlFormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML;
  }

  // Check for FB2 format
  if (isFb2FormatFile(buffer)) {
    return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2;
  }

  // Check for Open Office Flat format
  const openOfficeFlatFormat = isOpenOfficeFlatFormatFile(buffer);
  if (openOfficeFlatFormat.check) {
    return openOfficeFlatFormat.format;
  }

  // Check for DocFlat format
  if ((buffer[0] === 0xEC && buffer[1] === 0xA5) || (buffer[0] === 0xDC && buffer[1] === 0xA5) || (buffer[0] === 0xDB && buffer[1] === 0xA5)) {
    return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC_FLAT;
  }

  // Check for XlsFlat format
   if ((buffer[1] === 0x08 && buffer[0] === 0x09) || (buffer[1] === 0x04 && buffer[0] === 0x09) || (buffer[1] === 0x02 && buffer[0] === 0x09) ||
      (buffer[2] === 0x04 && buffer[0] === 0x09 && buffer[1] === 0x00 && buffer[3] === 0x00)) {
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS;
  }

  // Check for multi-parts HTML format.
  const xmlString = new TextDecoder().decode(buffer);
  if (xmlString.indexOf('Content-Type: multipart/related') !== -1 && xmlString.indexOf('Content-Type: text/html') !== -1) {
    return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML;
  }

  // Unknown format
  return constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
}
exports.getFormatFromString = function(ext) {
  switch (ext.toLowerCase()) {
    case 'docx':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX;
    case 'doc':
    case 'wps':
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
    case 'mhtml':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MHT;
    case 'epub':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB;
    case 'fb2':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2;
    case 'mobi':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_MOBI;
    case 'docm':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM;
    case 'dotx':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX;
    case 'dotm':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM;
    case 'fodt':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT;
    case 'ott':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT;
    case 'oform':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM;
    case 'docxf':
      return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF;

    case 'pptx':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX;
    case 'ppt':
    case 'dps':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT;
    case 'odp':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP;
    case 'ppsx':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX;
    case 'pptm':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM;
    case 'ppsm':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM;
    case 'potx':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX;
    case 'potm':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM;
    case 'fodp':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP_FLAT;
    case 'otp':
      return constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP;

    case 'xlsx':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX;
    case 'xls':
    case 'et':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS;
    case 'ods':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS;
    case 'csv':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV;
    case 'xlsm':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM;
    case 'xltx':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX;
    case 'xltm':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM;
    case 'xltb':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB;
    case 'fods':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT;
    case 'ots':
      return constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS;

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
    case 'pdfa':
      return constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA;
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
    case 'ooxml':
      return constants.AVS_OFFICESTUDIO_FILE_OTHER_OOXML;
    case 'odf':
      return constants.AVS_OFFICESTUDIO_FILE_OTHER_ODF;
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
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM:
      return 'docm';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX:
      return 'dotx';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM:
      return 'dotm';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT_FLAT:
      return 'fodt';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT:
      return 'ott';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOC_FLAT:
      return 'doc';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_FLAT:
      return 'docx';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML_IN_CONTAINER:
      return 'doc';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX_PACKAGE:
      return 'xml';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM:
      return 'oform';
    case constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF:
      return 'docxf';

    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX:
      return 'pptx';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPT:
      return 'ppt';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP:
      return 'odp';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX:
      return 'ppsx';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM:
      return 'pptm';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM:
      return 'ppsm';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX:
      return 'potx';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM:
      return 'potm';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP_FLAT:
      return 'fodp';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP:
      return 'otp';
    case constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX_PACKAGE:
      return 'xml';

    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX:
      return 'xlsx';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLS:
      return 'xls';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS:
      return 'ods';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV:
      return 'csv';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM:
      return 'xlsm';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX:
      return 'xltx';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM:
      return 'xltm';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSB:
      return 'xlsb';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS_FLAT:
      return 'fods';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS:
      return 'ots';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_FLAT:
      return 'xlsx';
    case constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX_PACKAGE:
      return 'xml';

    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF:
    case constants.AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDFA:
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
      return 'zip';
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
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_OOXML:
      return 'ooxml';
    case constants.AVS_OFFICESTUDIO_FILE_OTHER_ODF:
      return 'odf';
    default:
      return '';
  }
};
exports.getImageFormat = function(ctx, buffer) {
  var format = constants.AVS_OFFICESTUDIO_FILE_UNKNOWN;
  try {
    //signature
    format = getImageFormatBySignature(buffer);
  }
  catch (e) {
    ctx.logger.error('error getImageFormat: %s', e.stack);
  }
  return format;
};
exports.isDocumentFormat = function(format) {
  return 0 !== (format & constants.AVS_OFFICESTUDIO_FILE_DOCUMENT) ||
    format === constants.AVS_OFFICESTUDIO_FILE_CANVAS_WORD ||
    format === constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_DOCY;
};
exports.isSpreadsheetFormat = function(format) {
  return 0 !== (format & constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET) ||
    format === constants.AVS_OFFICESTUDIO_FILE_CANVAS_SPREADSHEET ||
    format === constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_XLSY;
};
exports.isPresentationFormat = function(format) {
  return 0 !== (format & constants.AVS_OFFICESTUDIO_FILE_PRESENTATION) ||
    format === constants.AVS_OFFICESTUDIO_FILE_CANVAS_PRESENTATION ||
    format === constants.AVS_OFFICESTUDIO_FILE_TEAMLAB_PPTY;
};
exports.isOOXFormat = function(format) {
  return constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX === format
  || constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM === format
  || constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX === format
  || constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM === format
  || constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM === format
  || constants.AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF === format
  || constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX === format
  || constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX === format
  || constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM === format
  || constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM === format
  || constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX === format
  || constants.AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM === format
  || constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX === format
  || constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM === format
  || constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX === format
  || constants.AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM === format;
};