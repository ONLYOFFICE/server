var fs = require("fs");
var path = require("path");
var constants  = require('./../../Common/sources/constants');
var formatChecker  = require('./../../Common/sources/formatchecker');
var utils  = require('./../../Common/sources/utils');

var filesDir = "../files";
fs.readdir(filesDir, function(err, data) {
  if (err) {
    console.log(err);
  } else {
    data.forEach(function(file) {
      if(fs.statSync(filesDir + "/" + file).isDirectory()) {
        return;
      }
      fs.readFile(filesDir + "/" + file, function(err, data) {
        if (err) {
          console.log(err);
        }else {
          try {
            var ext = path.extname(file);
            var format = formatChecker.getFileFormat(data, ext);
            ext = ext.replace(/[._]/g, '');
            if(constants.AVS_OFFICESTUDIO_FILE_UNKNOWN == format ||
              (formatChecker.getFormatFromString(ext) != format && ext != format))
              console.log(file + "-" + format);
          }
          catch(e) {
            console.log(e);
          }
        }
      });
    });
  }
});
