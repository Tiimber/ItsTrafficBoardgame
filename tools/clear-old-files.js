var moment = require('moment');
var fs = require('fs');
var path = require('path');

function checkFilesForRemoval(folder, files, i, limitMoment) {
    var file = path.join(folder, files[i]);
    fs.stat(file, function (statErr, stats) {
        var fileModification = moment(stats.mtime);
        if (fileModification.isBefore(limitMoment)) {
            fs.unlink(file, function (rmErr) {
                console.log('Removal of file:', file, rmErr ? 'FAILED' : 'SUCCESSFUL');
            });
        }
    });
    return file;
}

module.exports = function clearOldFiles(folder, minAgeHours) {
    minAgeHours = minAgeHours || 12;
    var limitMoment = moment();
    limitMoment.subtract(minAgeHours, 'hours');

    fs.readdir(folder, function(err, files) {
        if (!err) {
            for (var i = 0; i < files.length; i++) {
                var file = checkFilesForRemoval(folder, files, i, limitMoment);
            }
        }
    });
};
