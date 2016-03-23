// TODO
// - Edit node tags
// - Edit way tags
// - Sanity checks such as not possible to move node into node in same way, not possible to create a way between points crossing others or nodes already within same way
// - Add node to start/end of current ways
// - Undo
// - More colors, one for each highlighted node, with color in info panel

// Code for getting image data (and adding as an image to the page)
//var canvas = document.querySelector('canvas');
//var image = document.createElement('img');
//image.src = canvas.toDataURL("image/png");
//document.body.appendChild(image)

var globalMapData = {};
var placedOutSphereIds = {};
var scene;
var resolution = 1000;
//var resolution = 4000; // Example - really blown up
var wayHeightMap = 15; // Measure is in lon/lat (multiplied by 100 000)
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
    addWays();
    window.render();
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

function getTypeHTML(type) {
    switch (type) {
        case 'waypart':
            return '<span class="fa fa-road type-icon"></span>';
        case 'node':
            return '<span class="fa fa-dot-circle-o type-icon"></span>';
        default:
            return '<span class="fa fa-question type-icon"></span>';

    }
}

function updatePrint() {
    printInfo.apply(this, lastPrintInfo);
}

var lastPrintInfo = [];
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
        } else if (nextClick.type === 'createWay') {
            for (i = 0; i < data.length; i++) {
                var createTo = data[i].object || data[i];
                if (createTo.originType === 'node' && createTo.originId !== nextClick.obj) {
                    title = 'Confirm creating a new way between the two nodes?';
                    cancelBtn = true;
                    data = [].concat(highlighted);
                    data.push(createTo);
                    okCb = function () {
                        createWayBetweenNodes(data)
                    };
                }
            }
        }
    }

    // Save last info
    lastPrintInfo = [].slice.call(arguments, 0);

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
        itemData.innerHTML = getTypeHTML(object.originType) + ' ' + getInfo(object.originType, object.originId, object.originWPId);
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
            tagsData += '<span class="fa fa-tag"></span> ' + tagName + ': ' + item.tag[tagName];
        }
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

function editWayName(id, oldName) {
    var way = globalMapData.way[id];
    bootbox.prompt({
        title: 'Enter new name for this way:',
        value: oldName,
        callback: function(newName) {
            if (newName != null) {
                way.tag.name = newName;
                updatePrint();
            }
        }
    });
}

function getInfo(type, id, wayPartId) {
    var data;
    if (type === 'waypart') {
        var wayForPart = globalMapData.way[id];
        data = 'Part of <span class="underline">' + (wayForPart.tag.name ? wayForPart.tag.name : '?') + '</span> <a class="inline fa fa-eye" onclick="highlightWayAndNodes(\'' + id + '\');"></a>'; // Click to highlight all on this way
        data += ' <a class="inline fa fa-pencil" onclick="editWayName(\'' + id + '\', \'' + (wayForPart.tag.name || '') + '\')"></a>'; // Edit this name
        data += ' [<a class="inline" onclick="removeMapObj(\'' + type + '\', \'' + id + '\', \'' + wayPartId + '\')">DELETE</a>]'; // Delete this way part
        data += ' [<a class="inline" onclick="splitWayPart(\'' + type + '\', \'' + id + '\', \'' + wayPartId + '\')">SPLIT UP</a>]'; // Split this way part into two parts
    } else {
        data = getTags(globalMapData[type][id]);
        if (canRemove(type, id)) {
            data += ' [<a class="inline" onclick="removeMapObj(\'' + type + '\', \'' + id + '\')">DELETE</a>]'; // If possible - remove this node (or relation)
        }
        if (canMerge(type, id)) {
            data += ' [<a class="inline" onclick="mergeMapObj(\'' + type + '\', \'' + id + '\')">MOVE INTO OTHER POINT</a>]'; // If possible - merge this node into another one
        }

        if (type === 'node') {
            data += ' [<a class="inline" onclick="createWayFrom(\'' + type + '\', \'' + id + '\')">CREATE WAY TO ANOTHER NODE</a>]'; // Create a new way from this node to another one
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

function doSplitWayPart(wayId, wayPartId) {
    var way = globalMapData.way[wayId];
    var wayPartIndex;
    for (wayPartIndex = 0; wayPartIndex < way.wayParts.length; wayPartIndex++) {
        if (way.wayParts[wayPartIndex].originWPId === wayPartId) {
            break;
        }
    }

    var prevNode = getNode(way.nd[wayPartIndex].$.ref);
    var nextNode = getNode(way.nd[wayPartIndex + 1].$.ref);

    var newNodeId = makeid(16);
    var newMidNode = {$: {
            id: newNodeId,
            lon: prevNode.$.lon + Math.round((nextNode.$.lon - prevNode.$.lon) / 2),
            lat: prevNode.$.lat + Math.round((nextNode.$.lat - prevNode.$.lat) / 2)
    }};
    if (prevNode.tag && prevNode.tag.highway) {
        newMidNode.tag = {highway: prevNode.tag.highway};
    }

    globalMapData.node[newNodeId] = newMidNode;

    way.nd.splice(wayPartIndex + 1, 0, {$: {ref: newNodeId}});

    cleanupAndRerender();
}

function doRemoveWayPart(wayId, wayPartId) {
    var way = globalMapData.way[wayId];
    var numberOfWayParts = way.wayParts.length;
    var wayPartIndex;
    for (wayPartIndex = 0; wayPartIndex < numberOfWayParts; wayPartIndex++) {
        if (way.wayParts[wayPartIndex].originWPId === wayPartId) {
            break;
        }
    }

    var isFirstPart = wayPartIndex === 0;
    var isLastPart = wayPartIndex === numberOfWayParts - 1;

    // If only wayPart, remove way
    if (isFirstPart && isLastPart) {
        delete globalMapData.way[wayId];
    } else if (isFirstPart) {
        // If first part, only remove the first node
        way.nd.splice(0, 1);
    } else if (isLastPart) {
        way.nd.splice(way.nd.length - 1, 1);
    } else {
        // We need to split this way into two ways
        var newNodes = way.nd.splice(wayPartIndex + 1);

        var newId = makeid(16);
        globalMapData.way[newId] = {
            $: {id: newId},
            tag: JSON.parse(JSON.stringify(way.tag)),
            nd: newNodes
        };
    }

    cleanupAndRerender();
}

function makeid(length, numbersOnly) {
    var text = "";
    var possible = (numbersOnly ? "0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");

    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}

function cleanupAndRerender() {
    cleanCrossRefs();
    for(var childIndex = scene.children.length - 1; childIndex >= 0; childIndex--) {
        scene.remove(scene.children[childIndex]);
    }
    addWays();
    window.render();
}

function splitWayPart(type, id, wayPartId) {
    var splitChild;
    for (var i = 0; i < scene.children.length; i++) {
        var child = scene.children[i];
        if (child.originType === type && child.originId === id && child.originWPId === parseInt(wayPartId, 10)) {
            splitChild = child;
            printInfo('Split part of way to two parts?', [child], true, function(){
                doSplitWayPart(id, parseInt(wayPartId, 10));
            });
            break;
        }
    }
}

function removeMapObj(type, id, wayPartId) {
    var removeChild;
    for (var i = 0; i < scene.children.length; i++) {
        var child = scene.children[i];
        if (child.originType === type && child.originId === id && (!wayPartId || child.originWPId === parseInt(wayPartId, 10))) {
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

function createWayBetweenNodes(data) {
    var nodeFrom = getNode((data[0].object || data[0]).originId);
    var nodeTo = getNode((data[1].object || data[1]).originId);

    var newWayId = makeid(16);
    var way = {
        $: {id: newWayId},
        nd: [{$: {ref: nodeFrom.$.id}}, {$: {ref: nodeTo.$.id}}],
        tag: {highway: 'residential', name: 'User created way ' + newWayId}
    }
    globalMapData.way[newWayId] = way;

    cleanupAndRerender();
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
    nextClick = {type: 'move', obj: moveChild};
}

function createWayFrom(type, id) {
    var createFrom;
    for (var i = 0; i < scene.children.length; i++) {
        var child = scene.children[i];
        if (child.originType === type && child.originId === id) {
            createFrom = child;
            printInfo('Create way from node to ... (click on the other node):', [child], true);
            break;
        }
    }
    nextClick = {type: 'createWay', obj: createFrom};
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

    var renderer = new THREE.WebGLRenderer({preserveDrawingBuffer: true});
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    // Attach mouse hover listener
    var canvasX = renderer.domElement.offsetLeft;
    var canvasY = renderer.domElement.offsetTop;
    var canvasHeight = renderer.domElement.offsetHeight - 1;
    var canvasWidth = renderer.domElement.offsetWidth;
    renderer.domElement.addEventListener('mousedown', function (event) {
        var relativePoint = new THREE.Vector2(
            ((event.pageX - canvasX) / canvasWidth) * 2 - 1,
            - ((event.pageY - canvasY) / canvasHeight) * 2 + 1
        );
        mouseOn(scene, camera, raycaster, relativePoint);
    }, false);

    window.render = function render () {
//        requestAnimationFrame(window.render);

        renderer.render(scene, camera);
    };
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
    var geometry = new THREE.BoxGeometry(positionData.l, wayHeightMap, 0.0); // Y should be way size
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
        var geometry = new THREE.SphereGeometry(wayHeightMap / 2.0, 20, 20); // Y should be way size
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

            removeOutsideNodes(way.nd);
            // All nodes were outside, remove this way
            if (!way.nd.length) {
                delete globalMapData.way[wayId];
                continue;
            }

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

function isNodeOutside(lon, lat) {
    return lon < globalMapData.bounds.minX || lon > globalMapData.bounds.maxX || lat > globalMapData.bounds.minY || lat < globalMapData.bounds.maxY;
}

function removeOutsideNodes(nodes) {
    var i;
    var node;

    // We only want to keep one node outside the map in the beginning of the way
    var numberBeginningNodesOutside = 0;
    for (i = 0; i < nodes.length; i++, numberBeginningNodesOutside++) {
        node = getNode(nodes[i].$.ref).$;
        if (!isNodeOutside(node.lon, node.lat)) {
            break;
        }
    }

    if (numberBeginningNodesOutside > 1) {
        nodes.splice(0, numberBeginningNodesOutside - 1);
    }

    // We only want to keep one node outside the map in the end of the way
    var numberEndNodesOutside = 0;
    for (i = nodes.length - 1; i >= 0; i--, numberEndNodesOutside++) {
        node = getNode(nodes[i].$.ref).$;
        if (!isNodeOutside(node.lon, node.lat)) {
            break;
        }
    }

    if (numberEndNodesOutside > 1) {
        nodes.splice(nodes.length - (numberEndNodesOutside - 1));
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
