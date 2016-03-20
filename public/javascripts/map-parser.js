var globalMapData = {};
var placedOutSphereIds = {};
var scene;
var resolution = 1000;
//var resolution = 4000; // Example - really blown up
var wayHeightMapPct = 0.015;
var highlighted = [];
var nextClick = null;
var rollingUniqueId = 0;

var wayPartColor = 0xffffff;
var nodeColor = 0xccccff;

function parseMapData() {
    var data = window.mapData;
    globalMapData.bounds = {
        minX: data.bounds[0].$.minlon,
        maxX: data.bounds[0].$.maxlon,
        maxY: data.bounds[0].$.minlat, // Shift min and max here
        minY: data.bounds[0].$.maxlat
    };

    var hashTypes = ['node', 'way', 'relation'];
    for (var typeIndex = 0; typeIndex < hashTypes.length; typeIndex++) {
        var type = hashTypes[typeIndex];
        var list = {};
        for (var itemIndex = 0; itemIndex < data[type].length; itemIndex++) {
            var item = data[type][itemIndex];
            list[item.$.id] = item;
        }
        globalMapData[type] = list;
    }

    initCanvas();
    placeDataArea();
}

function placeDataArea() {
    var dataArea = document.createElement('div');
    dataArea.id = 'dataArea';
    document.body.appendChild(dataArea);
}

function deselectHighlights() {
    for (var i = 0; i < highlighted.length; i++) {
        var object = highlighted[i].object || highlighted[i];
        object.material.color.setHex(object.material.originalColor);
    }
}

function getHighlightForColor(c) {
    var r = (c & (0xff << 16)) >>> 16;
    var g = (c & (0xff << 8)) >>> 8;
    var b = (c & 0xff) / 0xff;
    var rgb = 'rgb(' + [r,g,b].join(',') + ')';

    var shadedColor = shadeRGBColor(rgb, -0.35);
    var highlightColor = eval('0x' + componentToHex(shadedColor.r) + componentToHex(shadedColor.g) + componentToHex(shadedColor.b));
    return highlightColor;
}

function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}

function shadeRGBColor(color, percent) {
    var f=color.split(","),t=percent<0?0:255,p=percent<0?percent*-1:percent,R=parseInt(f[0].slice(4)),G=parseInt(f[1]),B=parseInt(f[2]);
    return {
        r: Math.round((t-R)*p)+R,
        g: Math.round((t-G)*p)+G,
        b: Math.round((t-B)*p)+B
    };
}

function selectHighlights() {
    for (var i = 0; i < highlighted.length; i++) {
        var object = highlighted[i].object || highlighted[i];
        object.material.originalColor = object.material.color.getHex();
        object.material.color.setHex(getHighlightForColor(object.material.originalColor));
    }
}

function printInfo(title, data, cancelBtn, okCb) {
    var i;
    if (nextClick) {
        if (nextClick.type === 'move') {
            for (i = 0; i < data.length; i++) {
                var mergeWith = data[i].object || data[i];
                if (mergeWith.originType === 'node' && mergeWith.originId !== nextClick.obj) {
                    title = 'Confirm moving first node into second?';
                    cancelBtn = true;
                    data = [].concat(highlighted);
                    data.push(mergeWith);
                    okCb = function() {
                        mergeNodes(data)
                    };
                }
            }
        }
    }

    nextClick = null;
    var dataArea = document.querySelector('#dataArea');
    dataArea.innerHTML = '';

    var titleObj = document.createElement('div');
    titleObj.innerHTML = title;
    dataArea.appendChild(titleObj);

    for (i = 0; i < data.length; i++) {
        var itemData = document.createElement('div');
        itemData.style.marginLeft = '1em';
        var object = data[i].object || data[i];
        itemData.innerHTML = '- Type: ' + object.originType + ', info: ' + getInfo(object.originType, object.originId, object.originWPId);
        dataArea.appendChild(itemData);
    }

    if (okCb) {
        var okBtnObj = document.createElement('a');
        okBtnObj.className = 'positive';
        okBtnObj.innerHTML = 'Confirm!';
        okBtnObj.onclick = okCb;
        dataArea.appendChild(okBtnObj);
    }

    if (cancelBtn) {
        var cancelBtnObj = document.createElement('a');
        cancelBtnObj.className = 'negative';
        cancelBtnObj.innerHTML = 'Cancel';
        cancelBtnObj.onclick = function(){
            printInfo('', []);
        };
        dataArea.appendChild(cancelBtnObj);
    }

    deselectHighlights();
    highlighted = data;
    selectHighlights();
    window.render();
}

function getTags(item) {
    var tagsData = '';
    if (item.tag) {
        for (var tagName in item.tag) {
            tagsData += (tagsData.length ? ', ' : '') + tagName + ': ' + item.tag[tagName];
        }
    }
    if (!tagsData) {
        tagsData = '<span style="color: gray">-</span>';
    }
    return tagsData;
}

function canRemove(type, id) {
    if (type === 'node') {
        // Can't remove nodes in intersection, make sure it's only referenced in a single way
        var node = getNode(id);
        return !node.wayObjects || node.wayObjects.length === 1;
    }
    return false;
}

function canMerge(type, id) {
    if (type === 'node') {
        // Can merge node only if it is an endpoint of one way
        var node = getNode(id);
        return node.wayObjects && node.wayObjects.length === 1 && (node.wayObjects[0].nd[0].$.ref === id || node.wayObjects[0].nd[node.wayObjects[0].nd.length-1].$.ref === id);
    }
    return false;
}

function getInfo(type, id, wayPartId) {
    var data;
    if (type === 'waypart') {
        var wayForPart = globalMapData.way[id];
        data = 'Part of <a class="inline" onclick="highlightWayAndNodes(\'' + id + '\');">' + (wayForPart.tag.name ? wayForPart.tag.name : '?') + '</a>';
        data += ' [<a class="inline" onclick="removeMapObj(\'' + type + '\', \'' + id + '\', \'' + wayPartId + '\')">DELETE</a>]';
    } else {
        data = getTags(globalMapData[type][id]);
        if (canRemove(type, id)) {
            data += ' [<a class="inline" onclick="removeMapObj(\'' + type + '\', \'' + id + '\')">DELETE</a>]';
        }
        if (canMerge(type, id)) {
            data += ' [<a class="inline" onclick="mergeMapObj(\'' + type + '\', \'' + id + '\')">MOVE INTO OTHER POINT</a>]';
        }
    }
    return data;
}

function cleanCrossRefs() {
    for (var wayId in globalMapData.way) {
        delete globalMapData.way[wayId].nodeObjects;
        delete globalMapData.way[wayId].wayParts;
    }
    for (var nodeId in globalMapData.node) {
        delete globalMapData.node[nodeId].wayObjects;
    }
    placedOutSphereIds = {};
}

function doRemoveNode(nodeId) {
    var node = getNode(nodeId);
    var nodeWay = node.wayObjects[0];
    for (var i = 0; i < nodeWay.nd.length; i++) {
        if (nodeWay.nd[i].$.ref === nodeId) {
            nodeWay.nd.splice(i, 1);
            break;
        }
    }
    cleanupAndRerender();
}

function doRemoveWayPart(wayId, wayPartId) {
    console.log(wayId, wayPartId);
    // TODO - Fix this
/*
    var node = getNode(nodeId);
    var nodeWay = node.wayObjects[0];
    for (var i = 0; i < nodeWay.nd.length; i++) {
        if (nodeWay.nd[i].$.ref === nodeId) {
            nodeWay.nd.splice(i, 1);
            break;
        }
    }
    cleanupAndRerender();
*/
}

function cleanupAndRerender() {
    cleanCrossRefs();
    for(var childIndex = scene.children.length - 1; childIndex >= 0; childIndex--) {
        scene.remove(scene.children[childIndex]);
    }
    addWays();
    window.render();
}

function removeMapObj(type, id, wayPartId) {
    var removeChild;
    for (var i = 0; i < scene.children.length; i++) {
        var child = scene.children[i];
        if (child.originType === type && child.originId === id) {
            removeChild = child;
            printInfo('Remove selected node?', [child], true, function(){
                if (type === 'node') {
                    doRemoveNode(id);
                } else if (type === 'waypart') {
                    doRemoveWayPart(id, parseInt(wayPartId, 10));
                }
            });
            break;
        }
    }
}

function mergeNodes(data) {
    var nodeToReplace = (data[0].object || data[0]).originId;
    var nodeToReplaceWith = (data[1].object || data[1]).originId;

    var nodeObjToReplace = getNode(nodeToReplace);
    var nodeObjToReplaceWith = getNode(nodeToReplaceWith);
    for (var wayIndex = 0; wayIndex < nodeObjToReplace.wayObjects.length; wayIndex++) {
        var way = nodeObjToReplace.wayObjects[wayIndex];
        for (var nodeIndex = 0; nodeIndex < way.nd.length; nodeIndex++) {
            if (way.nd[nodeIndex].$.ref === nodeToReplace) {
                way.nd[nodeIndex].$.ref = nodeToReplaceWith;
                break;
            }
        }
    }
    delete globalMapData.node[nodeToReplace];

    cleanupAndRerender();
}

function mergeMapObj(type, id) {
    var moveChild;
    for (var i = 0; i < scene.children.length; i++) {
        var child = scene.children[i];
        if (child.originType === type && child.originId === id) {
            moveChild = child;
            printInfo('Move node into other (click on the one to merge with):', [child], true);
            break;
        }
    }
    nextClick = {type: 'move', obj: child};
}

function initCanvas() {
    var width = resolution;
    var height = resolution;

    var calculateRatioX = 37.0;
    //var calculateRatioX = 21.0; // To make it square (but stretch it)
    var calculateRatioY = 21.0;
    var widthPctOfHeight = (Math.abs(globalMapData.bounds.maxX - globalMapData.bounds.minX) / calculateRatioX) / (Math.abs(globalMapData.bounds.maxY - globalMapData.bounds.minY) / calculateRatioY);
    var canvas = document.querySelector('canvas');
    if (widthPctOfHeight > 1) {
        height = resolution / widthPctOfHeight;
    } else {
        width = resolution / widthPctOfHeight;
    }

    scene = new THREE.Scene();
    var raycaster = new THREE.Raycaster();
    //var camera = new THREE.PerspectiveCamera(globalMapData.bounds.maxX - globalMapData.bounds.minX, width / height, 0.1, 1000);
    var camera = new THREE.OrthographicCamera(globalMapData.bounds.minX, globalMapData.bounds.maxX, globalMapData.bounds.minY, globalMapData.bounds.maxY, 0.1, 1000);
    camera.position.z = 50;

    var renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    // Attach mouse hover listener
    var canvasX = renderer.domElement.offsetLeft;
    var canvasY = renderer.domElement.offsetTop;
    var canvasHeight = renderer.domElement.offsetHeight - 1;
    var canvasWidth = renderer.domElement.offsetWidth;
    renderer.domElement.addEventListener('mousedown', function (event) {
        var relativePoint = new THREE.Vector2(
            ((event.clientX - canvasX) / canvasWidth) * 2 - 1,
            - ((event.clientY - canvasY) / canvasHeight) * 2 + 1
        );
        mouseOn(scene, camera, raycaster, relativePoint);
    }, false);


    addWays();

    window.render = function render () {
//        requestAnimationFrame(window.render);

        renderer.render(scene, camera);
    };
    render();
}

function mouseOn(scene, camera, raycaster, pos) {
    raycaster.setFromCamera(pos, camera);
    var intersects = raycaster.intersectObjects(scene.children);
    var title = 'Items for clicked position "' + pos.x.toFixed(3) + ', ' + pos.y.toFixed(3) + '":';
    printInfo(title, intersects);
}

function highlightWayAndNodes(wayId) {
    var way = globalMapData.way[wayId];
    var wayMembers = [].concat(way.wayParts, way.nodeObjects);
    var title = 'Items for way "' + (way.tag && way.tag.name || '?') + '":';
    printInfo(title, wayMembers);
}

function addWayPart(positionData, scene, way) {
    // Create the part of the road
    var wayMaterial = new THREE.MeshBasicMaterial({color: wayPartColor});
    var geometry = new THREE.BoxGeometry(positionData.l, wayHeightMapPct * resolution, 0.0); // Y should be way size
    var cube = new THREE.Mesh(geometry, wayMaterial);
    cube.position.x = positionData.x;
    cube.position.y = positionData.y;
    cube.rotation.z = positionData.r;
    cube.originType = 'waypart';
    cube.originId = way.$.id;
    cube.originWPId = ++rollingUniqueId;
    scene.add(cube);

    // Add it to the globalMap, so we can access it
    way.wayParts.push(cube);
}

function addNodeObj(node, scene, way) {
    if (!node.wayObjects) {
        node.wayObjects = [];
    }

    if (!(node.$.id in placedOutSphereIds)) {
        //// Create the node point
        var nodeMaterial = new THREE.MeshBasicMaterial({color: nodeColor});
        var geometry = new THREE.SphereGeometry(wayHeightMapPct * resolution / 2.0, 20, 20); // Y should be way size
        var sphere = new THREE.Mesh(geometry, nodeMaterial);
        sphere.position.x = node.$.lon;
        sphere.position.y = node.$.lat;
        sphere.originType = 'node';
        sphere.originId = node.$.id;
        scene.add(sphere);
        way.nodeObjects.push(sphere);
        node.wayObjects.push(way);
        placedOutSphereIds[node.$.id] = sphere;
    } else {
        way.nodeObjects.push(placedOutSphereIds[node.$.id]);
        node.wayObjects.push(way);
    }
}

function addWays() {
    var ways = globalMapData.way;
    for (var wayId in ways) {
        var way = ways[wayId];
        if (way.tag && (way.tag.highway === 'residential' || way.tag.highway === 'pedestrian')) {
            way.wayParts = [];
            way.nodeObjects = [];

            var previousNode = getNode(way.nd[0].$.ref);
            addNodeObj(previousNode, scene, way);

            for (var i = 1; i < way.nd.length; i++) {
                var currentNode = getNode(way.nd[i].$.ref);
                addNodeObj(currentNode, scene, way);

                var wayPositionData = getPositionData(previousNode.$.lon, previousNode.$.lat, currentNode.$.lon, currentNode.$.lat);
                addWayPart(wayPositionData, scene, way);
                previousNode = currentNode;
            }
        }
    }
}

function getNode(id) {
    return globalMapData.node[id];
}

function getPositionData(x1, y1, x2, y2) {
    var w = x2 - x1;
    var h = y2 - y1;
    return {
        x: x1 + w / 2, // Mid x
        y: y1 + h / 2, // Mid y
        l: Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2)), // Length of way part
        r: Math.atan2(y2 - y1, x2 - x1) // Rotation of way part
    };
}
