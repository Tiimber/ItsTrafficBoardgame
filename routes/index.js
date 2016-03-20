var express = require('express');
var router = express.Router();

var fs = require('fs');
var path = require('path');

var randomstring = require('randomstring');
var xmlParse = require('xml2js').parseString;

var osmStripper = require('../tools/osm-stripper');
var clearOldFiles = require('../tools/clear-old-files');

/* GET home page. */
router.get('/', function (req, res, next) {
    res.render('index', {title: 'itsTraffic Board Generator'});
});

/* Start - choose mapfile */
router.get('/start', function (req, res, next) {
    res.render('start', {});
});

/* Preview - upload file and preview it */
router.post('/preview', function (req, res, next) {
    var uploadedMapInfo = req.files && req.files[0];
    var uploadedFilename = path.join(__dirname, '..', uploadedMapInfo.path);
    clearOldFiles(path.dirname(uploadedFilename), 1);
    var mapXmlData = fs.readFileSync(uploadedFilename);
    xmlParse(mapXmlData, function (err, jsonMapData) {
        var tmpNameSync = randomstring.generate() + '.js';
        var generatedTmpFile = path.join(__dirname, '..', 'public', 'javascripts', 'tmp', tmpNameSync);

        // Strip off uninteresting stuff
        osmStripper(jsonMapData);

        // Save tmp file for output
        clearOldFiles(path.dirname(generatedTmpFile), 1);
        fs.writeFileSync(generatedTmpFile, 'window.mapData = ' + JSON.stringify(jsonMapData.osm), 'utf-8');
        res.render('preview', {mapDataScript: 'javascripts/tmp/' + tmpNameSync});
    });
});

module.exports = router;
