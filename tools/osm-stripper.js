var lonLatMultipleFactor = 100000;

function makeBoundsLonLatNumbers(osm) {
    osm.bounds[0].$.minlon = fixLonLat(osm.bounds[0].$.minlon);
    osm.bounds[0].$.maxlon = fixLonLat(osm.bounds[0].$.maxlon);
    osm.bounds[0].$.minlat = fixLonLat(osm.bounds[0].$.minlat);
    osm.bounds[0].$.maxlat = fixLonLat(osm.bounds[0].$.maxlat);
}

function deleteStandardBloat(node) {
    delete node.$.changeset;
    delete node.$.timestamp;
    delete node.$.uid;
    delete node.$.user;
    delete node.$.version;
    delete node.$.visible;
    deleteTagBloat(node.tag);
}

function deleteTagBloat(tags) {
    if (tags) {
        for (var i = 0; i < tags.length; i++) {
            var tag = tags[i];
            // Remove source tag or localised tags
            if (tag.$.k === 'source' || tag.$.k.indexOf(':') !== -1) {
                tags.splice(i, 1);
                i--;
            }
        }
    }
}

var deleteBloatInNodes = function (osm/*, ...nodenames */) {
    var nodeNames = [].slice.call(arguments, 1);
    for (var i = 0; i < nodeNames.length; i++) {
        var list = osm[nodeNames[i]];
        for (var j = 0; j < list.length; j++) {
            var node = list[j];
            deleteStandardBloat(node);
        }
    }
};

function hasTag(node, key, value) {
    if (node && node.tag) {
        var tags = node.tag;
        for (var i = 0; i < tags.length; i++) {
            var tag = tags[i].$;
            if (tag.k === key) {
                if (value == undefined) {
                    return true;
                } else {
                    if (typeof value !== 'string') {
                        for (var j = 0; j < value.length; j++) {
                            if (tag.v === value[j]) {
                                return true;
                            }
                        }
                    } else if (tag.v === value) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

function fixLonLat(lonLatStr) {
    return Math.round(parseFloat(lonLatStr) * lonLatMultipleFactor);
}

function convertLongitudeAndLatitudeToNumbers(osm) {
    if (osm.node) {
        var nodeList = osm.node;
        for (var i = 0; i < nodeList.length; i++) {
            var node = nodeList[i];
            node.$.lat = fixLonLat(node.$.lat);
            node.$.lon = fixLonLat(node.$.lon);
        }
    }
}

function removeWaysTaggedAsFootway(osm) {
    if (osm.way) {
        var wayList = osm.way;
        for (var i = 0; i < wayList.length; i++) {
            var way = wayList[i];
            if (hasTag(way, "highway", ["footway"/*, "pedestrian"*/, "living_street", "service", "cycleway", "path", "steps"])) {
                wayList.splice(i, 1);
                i--;
            }
        }
    }
}

function removeUninterestingRelations(osm) {
    if (osm.relation) {
        var relationList = osm.relation;
        for (var i = 0; i < relationList.length; i++) {
            var relation = relationList[i];
            if (!hasTag(relation, "building", "yes")) {
                relationList.splice(i, 1);
                i--;
            }
        }
    }
}

function hasReferenceToNodeId (node, nodeId) {
    if (node) {
        for (var i = 0; i < node.length; i++) {
            var refs = node[i].nd;
            if (refs) {
                for (var j = 0; j < refs.length; j++) {
                    var ref = refs[j];
                    if (ref.$.ref === nodeId) {
                        return true;
                    }
                }
            }
        }
    }
}

function removeUnreferencedNodes(osm) {
    if (osm.node) {
        var nodeList = osm.node;
        for (var i = 0; i < nodeList.length; i++) {
            var nodeId = nodeList[i].$.id;
            if (!hasReferenceToNodeId(osm.way, nodeId) && !hasReferenceToNodeId(osm.relation, nodeId)) {
                nodeList.splice(i, 1);
                i--;
            }
        }
    }
}

function reorganizeTags(osm) {
    var nodeNames = [].slice.call(arguments, 1);
    for (var i = 0; i < nodeNames.length; i++) {
        var nodeList = osm[nodeNames[i]];
        for (var nodeIndex = 0; nodeIndex < nodeList.length; nodeIndex++) {
            var node = nodeList[nodeIndex];
            if (node.tag) {
                var tags = {};
                for (var j = 0; j < node.tag.length; j++) {
                    var tag = node.tag[j].$;
                    tags[tag.k] = tag.v;
                }
                node.tag = tags;
            }
        }
    }
}

module.exports = function stripOSM(data) {
    if (data && data.osm) {
        var osm = data.osm;

        // Make bounds containing longitude and latitude as numbers
        makeBoundsLonLatNumbers(osm);

        // Delete bloat in three root nodes
        deleteBloatInNodes(osm, 'node', 'way', 'relation');

        // Convert longitude and latitude into numbers instead of strings
        convertLongitudeAndLatitudeToNumbers(osm);

        // Remove ways that are tagged highway=footway
        removeWaysTaggedAsFootway(osm);

        // Remove relations that aren't multipolygon buildings
        removeUninterestingRelations(osm);

        // Remove unreferenced nodes
        removeUnreferencedNodes(osm);

        // Reorganize tags
        reorganizeTags(osm, 'node', 'way', 'relation');
    }
};
