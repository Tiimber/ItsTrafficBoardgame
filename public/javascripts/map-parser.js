// Code for getting image data (and adding as an image to the page)
//var canvas = document.querySelector('canvas');
//var image = document.createElement('img');
//image.src = canvas.toDataURL("image/png");
//document.body.appendChild(image)

var highlightColors = {
    waypart: [
        0xff0000,
        0xff00aa,
        0x00ff55,
        0x0033ff,
        0xcccc00,
        0xff6600,
        0x00ffff
    ],
    node: [
        0xff6666,
        0xff66aa,
        0x66ff99,
        0x6699ff,
        0xffff66,
        0xcc9966,
        0x66ffff
    ],
    nodeOfInterest: [
        0xff0000,
        0xff00aa,
        0x00ff55,
        0x0033ff,
        0xcccc00,
        0xff6600,
        0x00ffff
    ]
};

var globalMapData = {};
var placedOutSphereIds = {};
var scene;
var camera;
var resolution = 1000;
var zoomLevel = 1.0;
//var resolution = 4000; // Example - really blown up
var wayHeightMap = 15; // Measure is in lon/lat (multiplied by 100 000)
var highlighted = [];
var nextClick = null;
var rollingUniqueId = 0;

var targetNumberOfMapEntrances = 3;
var interestingNodeGroups = [
    {
        name: 'trafficSignals',
        label: 'Traffic Signals',
        icon: '/images/trafficLight_debug.png',
        domElementSelector: '[data-nodetype="traffic-light"]',
        type: 'traffic-light',
        target: 6
    },
    {
        name: 'food',
        label: 'Restaurants',
        icon: '/images/restaurant_debug.png',
        domElementSelector: '[data-nodetype="restaurant"]',
        type: 'restaurant',
        target: 3
    },
    {
        name: 'shop',
        label: 'Shops',
        icon: '/images/shop_debug.png',
        domElementSelector: '[data-nodetype="shop"]',
        type: 'shop',
        target: 3
    }
];

var selectedInterestingMapNodes = null;
var showInterestingNodes = false;
var clickOnMapToSelectNode = true;
var nodeTypeSelected = null;

var wayPartColor = 0xffffff;
var nodeColor = 0xccccff;
var interestingNodeColor = 0x66cc66;

var calculateRatioX = 37.0;
//var calculateRatioX = 21.0; // To make it square (but stretch it)
var calculateRatioY = 21.0;
var shortcutKeyDown = false;

var smallMapMove;
var largeMapMove;
var mapEntranceNodes;

function parseMapData() {
    var data = window.mapData;
    if (data.bounds.minX) {
        // If data was loaded directly from localCache or by entering JSON chunk, no extra processing needed
        globalMapData = data;
    } else {
        // File was uploaded, do some extra processing
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
    }

    globalMapData.bounds.width = Math.abs(globalMapData.bounds.maxX - globalMapData.bounds.minX);
    globalMapData.bounds.height = Math.abs(globalMapData.bounds.maxY - globalMapData.bounds.minY);
    globalMapData.bounds.centerX = globalMapData.bounds.minX + (globalMapData.bounds.maxX - globalMapData.bounds.minX) / 2;
    globalMapData.bounds.centerY = globalMapData.bounds.minY + (globalMapData.bounds.maxY - globalMapData.bounds.minY) / 2;

    // Calculate how much a small and big move should be when moving nodes
    smallMapMove = Math.round(globalMapData.bounds.width / (resolution / 4));
    largeMapMove = smallMapMove * 5;

    initCanvas();
    addWays();
    window.render();
    setZoomStates();
    setSaveLoadState();
    setUploadDownloadState();
    setNextStepState();
}

function presentInfo() {
    var currentPageIdNode = document.querySelector('.current-page-id');
    var page = currentPageIdNode.innerHTML;

    var fullInfo = '';
    fullInfo += 'Map entrances/exits: <span class="bold ' + (mapEntranceNodes.length === targetNumberOfMapEntrances ? 'green' : 'red') + '">' + mapEntranceNodes.length + '</span> (Expected: ' + targetNumberOfMapEntrances + ')<br/>';

    if (page !== 'preview') {
        interestingNodeGroups.forEach(function(interestingNodeGroup) {
            fullInfo += interestingNodeGroup.label + ': <span class="bold ' + (interestingNodeGroup.count === interestingNodeGroup.target ? 'green' : 'red') + '">' + interestingNodeGroup.count + '</span> (Expected: ' + interestingNodeGroup.target + ')<br/>';
        });
    } else {
        fullInfo += '<br/>In next step, you will decide on waypoint nodes.'
    }
    bootbox.dialog({
        title: 'Map summary',
        message: fullInfo
    });
}

var zoomLevels = [
    0.5,
    0.625,
    0.75,
    1.0
];

function zoomIn() {
    var levelIndex = zoomLevels.indexOf(zoomLevel);
    var canZoomIn = levelIndex < zoomLevels.length - 1;
    if (canZoomIn) {
        setZoomLevel(zoomLevels[levelIndex + 1]);
    }
}

function zoomOut() {
    var levelIndex = zoomLevels.indexOf(zoomLevel);
    var canZoomOut = levelIndex > 0;
    if (canZoomOut) {
        setZoomLevel(zoomLevels[levelIndex - 1]);
    }
}

function setZoomLevel(level) {
    var levelIndex = zoomLevels.indexOf(level);
    if (levelIndex !== -1) {
        zoomLevel = level;

        camera.zoom = zoomLevel;
        camera.updateProjectionMatrix();
        window.render();

        setZoomStates();
    }
}

function deselectHighlights() {
    for (var i = 0; i < highlighted.length; i++) {
        var object = highlighted[i].object || highlighted[i];
        object.material.color.setHex(object.material.originalColor);
    }
}

function getRgbString(c) {
    var r = (c & (0xff << 16)) >>> 16;
    var g = (c & (0xff << 8)) >>> 8;
    var b = (c & 0xff);
    return 'rgb(' + [r, g, b].join(',') + ')';
}

function getHighlightColor(object, colorCounters) {
    var nodeType = object.originType;
    var colorArrForType = highlightColors[nodeType];
    var colorForObject = colorArrForType[colorCounters[nodeType] % colorArrForType.length];
    colorCounters[nodeType]++;
    return colorForObject;
}

function selectHighlights() {
    var colorCounters = {waypart: 0, node: 0, nodeOfInterest: 0};
    for (var i = 0; i < highlighted.length; i++) {
        var object = highlighted[i].object || highlighted[i];
        object.material.originalColor = object.material.color.getHex();
        object.material.color.setHex(getHighlightColor(object, colorCounters));
    }
}

function getTypeHTML(type) {
    switch (type) {
        case 'waypart':
            return '<span class="fa fa-road type-icon"></span>';
        case 'node':
            return '<span class="fa fa-dot-circle-o type-icon"></span>';
        case 'nodeOfInterest':
            return '<span class="fa fa-crosshairs type-icon"></span>';
        default:
            return '<span class="fa fa-question type-icon"></span>';

    }
}

function selectMapNodeType() {
    var target = event.target;
    while (target !== document.body && !target.dataset['nodetype']) {
        target = target.parentNode;
    }
    var targetType = target.dataset['nodetype'];
    if (targetType) {
        if (nodeTypeSelected === targetType) {
            nodeTypeSelected = null;
        } else {
            nodeTypeSelected = targetType;
        }
        updateInterestingNodesToolbarInfo();
    }
}

function showInterestingNodesToolbar() {
    var dataArea = document.querySelector('#dataArea');
    dataArea.classList.add('invisible');

    var interestingNodesToolbar = document.querySelector('#interestingNodesToolbar');
    interestingNodesToolbar.classList.remove('invisible');
    interestingNodesToolbar.classList.add('visible');
    updateInterestingNodesToolbarInfo();
}

function removeAllInterestingNodes() {
    bootbox.confirm('Are you sure you want to remove all of these nodes?', function(result) {
        if (result) {
            saveBackupData();
            for (var sceneObjectIndex = 0; sceneObjectIndex < scene.children.length; sceneObjectIndex++) {
                var sceneObject = scene.children[sceneObjectIndex];
                if (sceneObject.originType === 'nodeOfInterest') {
                    doRemoveNodeOfInterest(sceneObject.originId, true);
                }
            }
            cleanupAndRerender();
        }
    });
}

function updateInterestingNodesToolbarInfo() {
    interestingNodeGroups.forEach(function(interestingNodeGroup) {
        var domNode = document.querySelector(interestingNodeGroup.domElementSelector);
        var actual = domNode.querySelector('.interesting-node-text-actual');
        var expected = domNode.querySelector('.interesting-node-text-expected');
        var count = interestingNodeGroup.count;
        var target = interestingNodeGroup.target;
        domNode.dataset['selected'] = nodeTypeSelected === interestingNodeGroup.type;
        actual.innerHTML = count;
        actual.dataset['expected'] = count === target;
        expected.innerHTML = target;
    });

    clickOnMapToSelectNode = !nodeTypeSelected;
    document.querySelector('#nodeInfoIfNoNodeSelected').style.display = clickOnMapToSelectNode ? 'block' : 'none';
    document.querySelector('#nodeInfoIfNodeSelected').style.display = nodeTypeSelected ? 'block' : 'none';
    if (nodeTypeSelected) {
        document.querySelector('#nodeTypeIfNodeSelected').innerHTML = nodeTypeSelected;
    }


    var hasInterestedSelectedNodes = selectedInterestingMapNodes && selectedInterestingMapNodes.length;
    document.querySelector('#nodeInfoMapNodeSelected').style.display = hasInterestedSelectedNodes ? 'block' : 'none';
    var nodeInfoMapNodeSelectedList = document.querySelector('#nodeInfoMapNodeSelectedList');
    nodeInfoMapNodeSelectedList.style.display = hasInterestedSelectedNodes ? 'block' : 'none';
    if (hasInterestedSelectedNodes) {
        while (nodeInfoMapNodeSelectedList.firstChild) {
            nodeInfoMapNodeSelectedList.removeChild(nodeInfoMapNodeSelectedList.firstChild);
        }
        var colorCounters = {nodeOfInterest: 0};
        for (i = 0; i < selectedInterestingMapNodes.length; i++) {
            var itemData = document.createElement('div');
            itemData.style.marginLeft = '1em';
            var object = selectedInterestingMapNodes[i].object;
            var color = getRgbString(getHighlightColor(object, colorCounters));
            itemData.innerHTML = getTypeHTML(object.originType) + '<span class="fa fa-square square" style="color: ' + color + ';"></span>' + getInfo(object.originType, object.originId, object.originWPId);
            nodeInfoMapNodeSelectedList.appendChild(itemData);
        }
    }
}

function updatePrint() {
    printInfo.apply(this, lastPrintInfo);
}

var lastPrintInfo = [];
function printInfo(title, data, cancelBtn, okCb) {
    if (!showInterestingNodes) {
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
                        okCb = function () {
                            saveBackupData();
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
                            saveBackupData();
                            createWayBetweenNodes(data)
                        };
                    }
                }
            }
        }

        if (shortcutKeyDown && okCb) {
            okCb();
            return;
        }

        // Save last info
        lastPrintInfo = [].slice.call(arguments, 0);

        nextClick = null;
        var dataArea = document.querySelector('#dataArea');
        dataArea.innerHTML = '';

        var titleObj = document.createElement('div');
        titleObj.innerHTML = title;
        dataArea.appendChild(titleObj);

        var colorCounters = {waypart: 0, node: 0};
        for (i = 0; i < data.length; i++) {
            var itemData = document.createElement('div');
            itemData.style.marginLeft = '1em';
            var object = data[i].object || data[i];
            var color = getRgbString(getHighlightColor(object, colorCounters));
            itemData.innerHTML = getTypeHTML(object.originType) + '<span class="fa fa-square square" style="color: ' + color + ';"></span>' + getInfo(object.originType, object.originId, object.originWPId);
            dataArea.appendChild(itemData);
        }

        if (okCb) {
            var okBtnObj = document.createElement('a');
            okBtnObj.className = 'positive';
            okBtnObj.id = 'confirm-action';
            okBtnObj.innerHTML = '<span class="underline">C</span>onfirm!';
            okBtnObj.onclick = okCb;
            dataArea.appendChild(okBtnObj);
        }

        if (cancelBtn) {
            var cancelBtnObj = document.createElement('a');
            cancelBtnObj.className = 'negative';
            cancelBtnObj.id = 'abort-action';
            cancelBtnObj.innerHTML = '<span class="underline">A</span>bort';
            cancelBtnObj.onclick = function () {
                printInfo('', []);
            };
            dataArea.appendChild(cancelBtnObj);
        }

        deselectHighlights();
        highlighted = data;
        selectHighlights();
        window.render();
    } else {
        deselectHighlights();
        highlighted = data;
        selectHighlights();
        window.render();
    }
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

function canRemoveMidNode(id) {
    // Can only remove if this node has two wayparts connected
    var node = getNode(id);
    return node.wayObjects && node.wayObjects.length === 2 && node.wayObjects[0] === node.wayObjects[1];
}

function canMerge(type, id) {
    if (type === 'node') {
        // Can merge node only if it is an endpoint of one way
        var node = getNode(id);
        return node.wayObjects && node.wayObjects.length === 1 && (node.wayObjects[0].nd[0].$.ref === id || node.wayObjects[0].nd[node.wayObjects[0].nd.length - 1].$.ref === id);
    }
    return false;
}

function editWayName(id, oldName) {
    var way = globalMapData.way[id];
    bootbox.prompt({
        title: 'Enter new name for this way:',
        value: oldName,
        callback: function (newName) {
            saveBackupData();
            if (newName != null) {
                way.tag.name = newName;
                updatePrint();
            }
        }
    });
}

function moveNode(id, movement) {
    saveBackupData();

    globalMapData.node[id].$.lon += movement.lon;
    globalMapData.node[id].$.lat += movement.lat;

    cleanupAndRerender();
    highlightNode(id);
}

function getInfo(type, id, wayPartId) {
    var data;
    if (type === 'waypart') {
        var wayForPart = globalMapData.way[id];
        data = 'Part of <span class="underline">' + (wayForPart.tag.name ? wayForPart.tag.name : '?') + '</span> <a class="inline fa fa-eye" title="Show everything for this way" onclick="highlightWayAndNodes(\'' + id + '\');"></a>'; // Click to highlight all on this way
        data += ' <a class="inline fa fa-pencil" title="Edit the name of this way" onclick="editWayName(\'' + id + '\', \'' + (wayForPart.tag.name || '') + '\')"></a>'; // Edit this name
        data += ' <a class="inline fa fa-trash" title="Delete this part of the way" onclick="removeMapObj(\'' + type + '\', \'' + id + '\', \'' + wayPartId + '\')"></a>'; // Delete this way part
        data += ' <a class="inline fa fa-share-alt" title="Split this part of the way into two pieces" onclick="splitWayPart(\'' + type + '\', \'' + id + '\', \'' + wayPartId + '\')"></a>'; // Split this way part into two parts
    } else if (type === 'nodeOfInterest') {
        data = 'Node ' + getTags(globalMapData.node[id]);
        data += ' <a class="inline fa fa-trash" title="Remove this node" onclick="removeMapObj(\'' + type + '\', \'' + id + '\')"></a>'; // Remove this node (or relation)
    } else {
        data = 'Node ' + getTags(globalMapData[type][id]);
        if (canRemove(type, id)) {
            data += ' <a class="inline fa fa-trash" title="Remove this node" onclick="removeMapObj(\'' + type + '\', \'' + id + '\')"></a>'; // If possible - remove this node (or relation)
        }
        if (canRemoveMidNode(id)) {
            data += ' <a class="inline fa fa-compress" title="Remove mid-node and merge two connected wayparts" onclick="removeMidNode(\'' + id + '\')"></a>' // If possible, remove this node and merge two connecting wayparts into one
        }
        if (canMerge(type, id)) {
            data += ' <a class="inline fa fa-arrows" title="Move (merge) this node with another" onclick="mergeMapObj(\'' + type + '\', \'' + id + '\')"></a>'; // If possible - merge this node into another one
        }

        if (type === 'node') {
            data += ' <a class="inline fa fa-long-arrow-left" title="Move node a chunk west" onclick="moveNode(\'' + id + '\', {lon: -' + largeMapMove + ', lat: 0})"></a>'; // Adjust node position a chunk west
            data += ' <a class="inline fa fa-arrow-left" title="Move node slightly west" onclick="moveNode(\'' + id + '\', {lon: -' + smallMapMove + ', lat: 0})"></a>'; // Adjust node position slightly west

            data += ' <a class="inline fa fa-arrow-right" title="Move node slightly east" onclick="moveNode(\'' + id + '\', {lon: ' + smallMapMove + ', lat: 0})"></a>'; // Adjust node position slightly east
            data += ' <a class="inline fa fa-long-arrow-right" title="Move node a chunk east" onclick="moveNode(\'' + id + '\', {lon: ' + largeMapMove + ', lat: 0})"></a>'; // Adjust node position a chunk east

            data += ' <a class="inline fa fa-long-arrow-up" title="Move node a chunk north" onclick="moveNode(\'' + id + '\', {lon: 0, lat: ' + largeMapMove + '})"></a>'; // Adjust node position a chunk north
            data += ' <a class="inline fa fa-arrow-up" title="Move node slightly north" onclick="moveNode(\'' + id + '\', {lon: 0, lat: ' + smallMapMove + '})"></a>'; // Adjust node position slightly north

            data += ' <a class="inline fa fa-arrow-down" title="Move node slightly south" onclick="moveNode(\'' + id + '\', {lon: 0, lat: -' + smallMapMove + '})"></a>'; // Adjust node position slightly south
            data += ' <a class="inline fa fa-long-arrow-down" title="Move node a chunk south" onclick="moveNode(\'' + id + '\', {lon: 0, lat: -' + largeMapMove + '})"></a>'; // Adjust node position a chunk south

            data += ' <a class="inline fa fa-link" title="Create a way between this and another node" onclick="createWayFrom(\'' + type + '\', \'' + id + '\')"></a>'; // Create a new way from this node to another one
        }
    }

    data += ' (' + id + ')';
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
    var newMidNode = {
        $: {
            id: newNodeId,
            lon: prevNode.$.lon + Math.round((nextNode.$.lon - prevNode.$.lon) / 2),
            lat: prevNode.$.lat + Math.round((nextNode.$.lat - prevNode.$.lat) / 2)
        }
    };
    if (prevNode.tag && prevNode.tag.highway) {
        newMidNode.tag = {highway: prevNode.tag.highway};
    }

    globalMapData.node[newNodeId] = newMidNode;

    way.nd.splice(wayPartIndex + 1, 0, {$: {ref: newNodeId}});

    cleanupAndRerender();
}

function doRemoveWayPart(wayId, wayPartId, preventCleanupAndRerender) {
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

    if (!preventCleanupAndRerender) {
        cleanupAndRerender();
    }
}

function doRemoveNodeOfInterest(id, preventCleanupAndRerender) {
    var node = globalMapData.node[id];
    removeInterestingNodeTags(node);
    selectedInterestingMapNodes = null;
    if (!preventCleanupAndRerender) {
        cleanupAndRerender();
    }
}

function makeid(length, numbersOnly) {
    var text = "";
    var possible = (numbersOnly ? "0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");

    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }

    return text;
}

var backupData = [];
var currentKeptBackupData = null;
var forwardData = [];
function saveBackupData() {
    backupData.push(currentKeptBackupData);
    forwardData = [];
    setUndoRedoState();
}

function exportData() {
    bootbox.alert({
        title: 'Current map data:',
        message: '<textarea onfocus="this.onclick();" onblur="this.onclick();" onclick="this.setSelectionRange(0, this.value.length);">' + JSON.stringify(currentKeptBackupData) + '</textarea>'
    });
}

function importData() {
    bootbox.prompt({
        title: 'Input map data:',
        value: '',
        callback: function(data) {
            if (data) {
                var dataObj = JSON.parse(data);
                if (scene) {
                    saveBackupData();
                    globalMapData = dataObj;
                    cleanupAndRerender();
                } else {
                    postForm(dataObj, '/preview');
                }
            }
        }
    });
}

function postForm(json, url) {
    var form = document.createElement('form');
    form.action = url;
    form.method = 'POST';

    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'data';
    input.value = JSON.stringify(json);
    form.appendChild(input);

    form.submit();
}

function load() {
    bootbox.prompt({
        title: 'Enter name to load',
        value: '',
        callback: function(loadname) {
            if (loadname) {
                var data = window.localStorage.getItem('itsboard_' + loadname);
                if (data) {
                    var dataObj = JSON.parse(data);
                    if (scene) {
                        saveBackupData();
                        globalMapData = dataObj;
                        cleanupAndRerender();
                    } else {
                        postForm(dataObj, '/preview');
                    }
                }
            }
        }
    });
}

function save() {
    bootbox.prompt({
        title: 'Enter name to save as',
        value: '',
        callback: function(savename) {
            if (savename) {
                window.localStorage.setItem('itsboard_' + savename, JSON.stringify(currentKeptBackupData));
            }
        }
    });
}

function undo() {
    if (backupData.length) {
        cleanCrossRefs();
        for (var childIndex = scene.children.length - 1; childIndex >= 0; childIndex--) {
            scene.remove(scene.children[childIndex]);
        }

        forwardData.push(JSON.parse(JSON.stringify(globalMapData)));
        globalMapData = backupData.splice(backupData.length - 1, 1)[0];

        printInfo('', []);
        addWays();
        window.render();
        updateInterestingNodesToolbarInfo();

        setUndoRedoState();
    }
}

function redo() {
    if (forwardData.length) {
        cleanCrossRefs();
        for (var childIndex = scene.children.length - 1; childIndex >= 0; childIndex--) {
            scene.remove(scene.children[childIndex]);
        }

        backupData.push(JSON.parse(JSON.stringify(globalMapData)));
        globalMapData = forwardData.splice(forwardData.length - 1, 1)[0];

        printInfo('', []);
        addWays();
        window.render();
        updateInterestingNodesToolbarInfo();

        setUndoRedoState();
    }
}

function setSaveLoadState() {
    document.querySelector('.top .save').dataset['disabled'] = false;
    document.querySelector('.top .load').dataset['disabled'] = false;
}

function setUploadDownloadState() {
    document.querySelector('.top .upload').dataset['disabled'] = false;
    document.querySelector('.top .download').dataset['disabled'] = false;
}

function nextStep() {
    var currentPageIdNode = document.querySelector('.current-page-id');
    var page = currentPageIdNode.innerHTML;
    switch (page) {
        case 'preview':
            printInfo('', []);
            currentPageIdNode.innerHTML = 'preview-2';
            showInterestingNodes = true;
            cleanupAndRerender();
            setNextStepState();
            showInterestingNodesToolbar();
            break;
    }
}

function areCriteriasMet() {
    var nextStepButton = document.querySelector('.top .next-step');
    var page = document.querySelector('.current-page-id').innerHTML;
    switch (page) {
        case 'preview-2':
            var anyInterestingNodeGroupNotMet = false;
            interestingNodeGroups.forEach(function (interestingNodeGroup) {
                if (interestingNodeGroup.count !== interestingNodeGroup.target) {
                    anyInterestingNodeGroupNotMet = true;
                }
            });
            return !anyInterestingNodeGroupNotMet;
        case 'preview':
            return mapEntranceNodes.length === targetNumberOfMapEntrances;
        default:
            return true;
    }
}

function setNextStepState() {
    var nextStepButton = document.querySelector('.top .next-step');
    var page = document.querySelector('.current-page-id').innerHTML;
    switch (page) {
        case 'preview-2':
            nextStepButton.dataset['disabled'] = areCriteriasMet() ? 'false' : 'true';
            nextStepButton.title = 'TODO - Give title';
            break;
        case 'preview':
            nextStepButton.dataset['disabled'] = areCriteriasMet() ? 'false' : 'true';
            nextStepButton.title = 'Edit nodes and spots';
            break;
        case 'start':
        default:
            nextStepButton.dataset['disabled'] = 'true';
            nextStepButton.title = '';
            break;
    }
}

function setUndoRedoState() {
    var canUndo = backupData.length;
    var canRedo = forwardData.length;
    document.querySelector('.top .undo').dataset['disabled'] = !canUndo;
    document.querySelector('.top .redo').dataset['disabled'] = !canRedo;
}


function setZoomStates() {
    var levelIndex = zoomLevels.indexOf(zoomLevel);
    var canZoomOut = levelIndex > 0;
    var canZoomIn = levelIndex < zoomLevels.length - 1;
    document.querySelector('.top .zoomin').dataset['disabled'] = !canZoomIn;
    document.querySelector('.top .zoomout').dataset['disabled'] = !canZoomOut;
}

function cleanupAndRerender() {
    cleanCrossRefs();
    for (var childIndex = scene.children.length - 1; childIndex >= 0; childIndex--) {
        scene.remove(scene.children[childIndex]);
    }
    printInfo('', []);
    addWays();
    updateInterestingNodesToolbarInfo();
    window.render();
    setNextStepState();
}

function splitWayPart(type, id, wayPartId) {
    var splitChild;
    for (var i = 0; i < scene.children.length; i++) {
        var child = scene.children[i];
        if (child.originType === type && child.originId === id && child.originWPId === parseInt(wayPartId, 10)) {
            splitChild = child;
            printInfo('Split part of way to two parts?', [child], true, function () {
                saveBackupData();
                doSplitWayPart(id, parseInt(wayPartId, 10));
            });
            break;
        }
    }
}

function removeMapObj(type, id, wayPartId) {
    if (type === 'way') {
        var way = globalMapData.way[id];
        printInfo('Remove entire way?', way.wayParts, true, function () {
            saveBackupData();
            while (way.wayParts.length) {
                var wayPart = way.wayParts[0];
                doRemoveWayPart(id, wayPart.originWPId, true);
                way.wayParts.splice(0, 1);
            }
            cleanupAndRerender();
        });
    } else {
        var removeChild;
        for (var i = 0; i < scene.children.length; i++) {
            var child = scene.children[i];
            if (child.originType === type && child.originId === id && (!wayPartId || child.originWPId === parseInt(wayPartId, 10))) {
                removeChild = child;
                // Instant remove
                if (type === 'nodeOfInterest') {
                    saveBackupData();
                    doRemoveNodeOfInterest(id);
                } else {
                    printInfo('Remove selected node?', [child], true, function () {
                        saveBackupData();
                        if (type === 'node') {
                            doRemoveNode(id);
                        } else if (type === 'waypart') {
                            doRemoveWayPart(id, parseInt(wayPartId, 10));
                        }
                    });
                }
                break;
            }
        }
    }
}

function wayObjectConnectedToNode(nodeId, wayId, wayObjectId) {
    var way = globalMapData.way[wayId];

    if (way && way.nd && way.wayParts) {
        var i;
        for (i = 0; i < way.nd.length; i++) {
            if (way.nd[i].$.ref === nodeId) {
                return (i > 0 && way.wayParts[i-1].originWPId === wayObjectId) || (i < way.wayParts.length && way.wayParts[i].originWPId === wayObjectId);
            }
        }
    }

    return false;
}

function doRemoveMidNode(nodeId, wayId) {
    delete globalMapData.node[nodeId];
    var way = globalMapData.way[wayId];
    for (var wayNodeIndex = 0; wayNodeIndex < way.nd.length; wayNodeIndex++) {
        var wayNode = way.nd[wayNodeIndex];
        if (wayNode.$.ref === nodeId) {
            way.nd.splice(wayNodeIndex, 1);
            break;
        }
    }
    cleanupAndRerender();
}

function removeMidNode(id) {
    var node = globalMapData.node[id];
    var mergeTogether = [];
    var wayId = -1;
    for (var i = 0; i < scene.children.length; i++) {
        var child = scene.children[i];
        if ((child.originType === 'node' && child.originId === id) || (child.originType === 'waypart' && wayObjectConnectedToNode(id, child.originId, child.originWPId))) {
            if (child.originType === 'node') {
                mergeTogether.splice(0, 0, child);
            } else {
                mergeTogether.push(child);
                wayId = child.originId;
            }
        }
    }
    printInfo('Remove node and merge way parts?', mergeTogether, true, function () {
        saveBackupData();
        doRemoveMidNode(id, wayId);
    });
}

function createWayBetweenNodes(data) {
    var nodeFrom = getNode((data[0].object || data[0]).originId);
    var nodeTo = getNode((data[1].object || data[1]).originId);

    var newWayId = makeid(16);
    var way = {
        $: {id: newWayId},
        nd: [{$: {ref: nodeFrom.$.id}}, {$: {ref: nodeTo.$.id}}],
        tag: {highway: 'residential', name: 'User created way ' + newWayId}
    };
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

    var widthPctOfHeight = (Math.abs(globalMapData.bounds.maxX - globalMapData.bounds.minX) / calculateRatioX) / (Math.abs(globalMapData.bounds.maxY - globalMapData.bounds.minY) / calculateRatioY);
    var canvas = document.querySelector('canvas');
    if (widthPctOfHeight > 1) {
        height = resolution / widthPctOfHeight;
    } else {
        width = resolution / widthPctOfHeight;
    }

    scene = new THREE.Scene();
    var raycaster = new THREE.Raycaster();
    camera = new THREE.OrthographicCamera(globalMapData.bounds.minX, globalMapData.bounds.maxX, globalMapData.bounds.minY, globalMapData.bounds.maxY, 0.1, 1000);
    //var xSpan = Math.abs(globalMapData.bounds.maxX - globalMapData.bounds.minX);
    //var ySpan = Math.abs(globalMapData.bounds.maxY - globalMapData.bounds.minY);
    //var camera = new THREE.OrthographicCamera(globalMapData.bounds.minX - xSpan / 20, globalMapData.bounds.maxX + xSpan / 20, globalMapData.bounds.minY  + ySpan / 20, globalMapData.bounds.maxY - ySpan / 20, 0.1, 1000);
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
        var pctX = ((event.pageX - canvasX) / canvasWidth);
        var pctY = ((event.pageY - canvasY) / canvasHeight);
        var relativePoint = new THREE.Vector2(
            pctX * 2 - 1,
            -pctY * 2 + 1
        );
        var relativePointAbsolute = {x: pctX, y: pctY};
        mouseOn(camera, raycaster, relativePoint, relativePointAbsolute);
    }, false);

    document.addEventListener('keydown', function(event) {
        shortcutKeyDown = event.altKey;
    });

    document.addEventListener('keyup', function(event) {
        shortcutKeyDown = event.altKey;
        var char = String.fromCharCode(event.keyCode);
        if (char.toLowerCase() === 'c') {
            var confirmLink = document.querySelector('#confirm-action');
            if (confirmLink) {
                clickObject(confirmLink);
            }
        } else if (char.toLocaleLowerCase() === 'a') {
            var abortLink = document.querySelector('#abort-action');
            if (abortLink) {
                clickObject(abortLink);
            }
        }
    });

    window.render = function render() {
        //requestAnimationFrame(window.render);

        renderer.render(scene, camera);
    };
}

function clickObject(object) {
    var evt = document.createEvent("MouseEvents");
    evt.initMouseEvent("click", true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);

    object.dispatchEvent(evt);
}

function mouseOn(camera, raycaster, pos, relativePos) {
    var intersects;
    if (!showInterestingNodes) {
        raycaster.setFromCamera(pos, camera);
        intersects = raycaster.intersectObjects(scene.children);
        var title = 'Items for clicked position "' + pos.x.toFixed(3) + ', ' + pos.y.toFixed(3) + '":';
        printInfo(title, intersects);
    } else if (clickOnMapToSelectNode) {
        raycaster.setFromCamera(pos, camera);
        intersects = raycaster.intersectObjects(scene.children);
        intersects = intersects.filter(function(item) { return item.object.originType === 'nodeOfInterest'; });
        selectedInterestingMapNodes = intersects;
        updateInterestingNodesToolbarInfo();
        printInfo(null, intersects);
    } else {
        saveBackupData();
        var newNodeId = makeid(16);
        var nodeTags = {};
        if (nodeTypeSelected === 'shop') {
            nodeTags['shop'] = 'shop';
        } else if (nodeTypeSelected === 'restaurant') {
            nodeTags['amenity'] = 'restaurant';
        } else if (nodeTypeSelected === 'traffic-light') {
            nodeTags['highway'] = 'traffic_signals';
        }
        var newMidNode = {
            $: {
                id: newNodeId,
                lon: globalMapData.bounds.minX + Math.round(relativePos.x * globalMapData.bounds.width),
                lat: globalMapData.bounds.maxY + Math.round((1-relativePos.y) * globalMapData.bounds.height)
            },
            tag: nodeTags
        };
        globalMapData.node[newNodeId] = newMidNode;
        cleanupAndRerender();
    }
}

function highlightWayAndNodes(wayId) {
    var way = globalMapData.way[wayId];
    var wayMembers = [].concat(way.wayParts, way.nodeObjects);
    var title = 'Items for way "' + (way.tag && way.tag.name || '?') + '": <a class="fa fa-trash" onclick="removeMapObj(\'way\', ' + wayId + ');"></a>';
    printInfo(title, wayMembers);
}

function highlightNode(nodeId) {
    for (var i = 0; i < scene.children.length; i++) {
        var child = scene.children[i];
        if (child.originType === 'node' && child.originId === nodeId) {
            printInfo('Moved node', [child]);
            return;
        }
    }
}

function addWayPart(positionData, way) {
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

function addNodeObj(node, way) {
    if (!node.wayObjects) {
        node.wayObjects = [];
    }

    if (!(node.$.id in placedOutSphereIds)) {
        //// Create the node point
        var colorForNode = showInterestingNodes ? wayPartColor : nodeColor;
        var nodeMaterial = new THREE.MeshBasicMaterial({color: colorForNode});
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

function addOutlines() {
    var posBottomLeft = new THREE.Vector3(globalMapData.bounds.minX, globalMapData.bounds.minY, 0);
    var posBottomRight = new THREE.Vector3(globalMapData.bounds.maxX, globalMapData.bounds.minY, 0);
    var posTopLeft = new THREE.Vector3(globalMapData.bounds.minX, globalMapData.bounds.maxY, 0);
    var posTopRight = new THREE.Vector3(globalMapData.bounds.maxX, globalMapData.bounds.maxY, 0);

    var outlineMaterial = new THREE.LineBasicMaterial({color: 0x9999cc});
    var geometry = new THREE.Geometry();
    geometry.vertices.push(posBottomLeft, posBottomRight, posTopRight, posTopLeft, posBottomLeft);
    var side = new THREE.Line(geometry, outlineMaterial);
    scene.add(side);
}

function addBuildings() {

}

var logoPctOfMap = 0.12;
var logoOriginalWidth = 525;
var logoOriginalHeight = 401;

function addLogo() {
/*
    var img = new THREE.MeshBasicMaterial({
        map: THREE.ImageUtils.loadTexture('/images/logo.png')
    });
    img.map.needsUpdate = true;

    var goalWidth = logoPctOfMap * globalMapData.bounds.width;
    var goalHeight = logoOriginalHeight / logoOriginalWidth * goalWidth * (calculateRatioY / calculateRatioX);

    var image = new THREE.Mesh(new THREE.PlaneGeometry(goalWidth, goalHeight), img);
    image.position.x = globalMapData.bounds.maxX - goalWidth / 2;
    image.position.y = globalMapData.bounds.maxY + goalHeight / 2;
    image.overdraw = true;
    scene.add(image);
*/
}

function getDistance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(Math.abs(x1 - x2), 2) + Math.pow(Math.abs(y1 - y2), 2));
}

function getAverage(values) {
    if (values) {
        var sum = values.reduce(function(a, b) { return a + b; });
        return sum / values.length;
    }
}

function collect4WayCrossings() {
    globalMapData.trafficLightCandidates = [];
    for (var nodeId in globalMapData.node) {
        if (globalMapData.trafficLightCandidates.indexOf(nodeId) === -1) {
            var node = globalMapData.node[nodeId];
            if (node.wayObjects && node.wayObjects.length === 4) {
                var entrancePointsDistances = [];
                mapEntranceNodes.forEach(function(entranceNodeRef) {
                    var entranceNode = getNode(entranceNodeRef.$.ref);
                    entrancePointsDistances.push(getDistance(node.$.lon, node.$.lat, entranceNode.$.lon, entranceNode.$.lat));
                });

                var nodeInfo = {
                    id: nodeId,
                    avgDistanceFromEntries: getAverage(entrancePointsDistances),
                    distanceFromCenter: getDistance(globalMapData.bounds.centerX, globalMapData.bounds.centerY, node.$.lon, node.$.lat),
                    maxDistanceFromEntry: Math.max.apply(null, entrancePointsDistances),
                    minDistanceFromEntry: Math.min.apply(null, entrancePointsDistances)
                };
                globalMapData.trafficLightCandidates.push(nodeInfo);
            }
        }
    }
}

function addWays() {
    mapEntranceNodes = [];
    currentKeptBackupData = JSON.parse(JSON.stringify(globalMapData));

    var ways = globalMapData.way;
    for (var wayId in ways) {
        var way = ways[wayId];
        if (way.tag && (way.tag.highway === 'residential' || way.tag.highway === 'pedestrian' || way.tag.highway === 'primary' || way.tag.highway === 'secondary' || way.tag.highway === 'tertiary')) {
            way.wayParts = [];
            way.nodeObjects = [];

            var entranceNodes = removeOutsideNodes(way.nd);
            // All nodes were outside, remove this way
            if (!way.nd.length) {
                delete globalMapData.way[wayId];
                continue;
            }

            if (entranceNodes && entranceNodes.length) {
                mapEntranceNodes = [].concat(mapEntranceNodes, entranceNodes);
            }

            var previousNode = getNode(way.nd[0].$.ref);
            for (var i = 1; i < way.nd.length; i++) {
                addNodeObj(previousNode, way);
                var currentNode = getNode(way.nd[i].$.ref);
                addNodeObj(currentNode, way);

                var wayPositionData = getPositionData(previousNode.$.lon, previousNode.$.lat, currentNode.$.lon, currentNode.$.lat);
                addWayPart(wayPositionData, way);
                previousNode = currentNode;
            }
        } else {
            //console.log(way.tag && way.tag.highway);
        }
    }

    addOutlines();
    addBuildings();
    addLogo();
    gatherNodesOfInterest();
    collect4WayCrossings();

    if (showInterestingNodes) {
        var rerenderDebounced = debounce(window.render, 50);
        // The nodes we are interested in...
        for (var nodeGroupIndex = 0; nodeGroupIndex < interestingNodeGroups.length; nodeGroupIndex++) {
            var interestingNodeGroup = interestingNodeGroups[nodeGroupIndex];
            var interestingNodes = globalMapData.nodesOfInterest[interestingNodeGroup.name];
            interestingNodeGroup.count = 0;
            if (interestingNodes) {
                for (var nodeIndex = 0; nodeIndex < interestingNodes.length; nodeIndex++) {
                    var node = interestingNodes[nodeIndex];
                    var image = new THREE.TextureLoader().load(interestingNodeGroup.icon, rerenderDebounced);
                    var material = new THREE.SpriteMaterial({map: image});
                    var sprite = new THREE.Sprite(material);
                    sprite.position.x = node.$.lon;
                    sprite.position.y = node.$.lat;
                    sprite.position.z = 10;
                    sprite.scale.x = globalMapData.bounds.width / resolution * 20;
                    sprite.scale.y = globalMapData.bounds.height / resolution * 20;
                    sprite.originType = 'nodeOfInterest';
                    sprite.originId = node.$.id;
                    scene.add(sprite);
                    interestingNodeGroup.count++;
                }
            }
        }
    }
}

function hasTagWithValues(tags, key, values) {
    values = [].splice.call(arguments, 2);

    if (key in tags) {
        if (values.indexOf(tags[key]) !== -1) {
            return true;
        }
    }

    return false;
}

function removeTagWithValues(tags, key, values) {
    values = [].splice.call(arguments, 2);

    if (key in tags) {
        if (values.indexOf(tags[key]) !== -1) {
            delete tags[key];
        }
    }
}

function hasTags(tags, names) {
    names = [].splice.call(arguments, 1);

    for (var i = 0; i < names.length; i++) {
        if (names[i] in tags) {
            return true;
        }
    }

    return false;
}

function removeTags(tags, names) {
    names = [].splice.call(arguments, 1);

    for (var i = 0; i < names.length; i++) {
        if (names[i] in tags) {
            delete tags[names[i]];
        }
    }
}

function isShop(tags) {return hasTags(tags, 'shop');}
function isTrafficSignals(tags) {return hasTagWithValues(tags, 'highway', 'traffic_signals');}
function isCrossing(tags) {return hasTagWithValues(tags, 'highway', 'crossing');}
function isRestaurant(tags) {return hasTagWithValues(tags, 'amenity', 'fast_food', 'pub', 'restaurant', 'cafe');}
function isTree(tags) {return hasTagWithValues(tags, 'natural', 'tree');}
function isPublicTransport(tags) {return hasTagWithValues(tags, 'highway', 'bus_stop') || hasTagWithValues(tags, 'shelter_type', 'public_transport') || hasTagWithValues(tags, 'public_transport', 'platform');}
function isHotel(tags) {return hasTagWithValues(tags, 'tourism', 'hotel');}
function isATM(tags) {return hasTagWithValues(tags, 'amenity', 'atm');}
function isParking(tags) {return hasTagWithValues(tags, 'amenity', 'parking');}

function removeShop(tags) {removeTags(tags, 'shop');}
function removeTrafficSignals(tags) {removeTagWithValues(tags, 'highway', 'traffic_signals');}
function removeCrossing(tags) {removeTagWithValues(tags, 'highway', 'crossing');}
function removeRestaurant(tags) {removeTagWithValues(tags, 'amenity', 'fast_food', 'pub', 'restaurant', 'cafe');}
function removeTree(tags) {removeTagWithValues(tags, 'natural', 'tree');}
function removePublicTransport(tags) {removeTagWithValues(tags, 'highway', 'bus_stop'); removeTagWithValues(tags, 'shelter_type', 'public_transport'); removeTagWithValues(tags, 'public_transport', 'platform');}
function removeHotel(tags) {removeTagWithValues(tags, 'tourism', 'hotel');}
function removeATM(tags) {removeTagWithValues(tags, 'amenity', 'atm');}
function removeParking(tags) {removeTagWithValues(tags, 'amenity', 'parking');}

function removeInterestingNodeTags(node) {
    if ('tag' in node && Object.getOwnPropertyNames(node.tag).length) {
        var tags = node.tag;
        if (isShop(tags)) {
            removeShop(tags);
        } else if (isTrafficSignals(tags)) {
            removeTrafficSignals(tags);
        } else if (isCrossing(tags)) {
            removeCrossing(tags);
        } else if (isRestaurant(tags)) {
            removeRestaurant(tags);
        } else if (isTree(tags)) {
            removeTree(tags);
        } else if (isPublicTransport(tags)) {
            removePublicTransport(tags);
        } else if (isHotel(tags)) {
            removeHotel(tags);
        } else if (isATM(tags)) {
            removAtm(tags);
        } else if (isParking(tags)) {
            removeParking(tags);
        }
    }
}

function gatherNodesOfInterest() {
    var nodeIds = Object.getOwnPropertyNames(globalMapData.node);

    globalMapData.nodesOfInterest = nodeIds.reduce(
        function (previous, key) {
            var node = globalMapData.node[key];
            if (!isNodeOutside(node.$.lon, node.$.lat)) {
                if ('tag' in node && Object.getOwnPropertyNames(node.tag).length) {
                    var tags = node.tag;
                    var addToType = 'other';
                    // Detect what type it is
                    if (isShop(tags)) {
                        addToType = 'shop';
                    } else if (isTrafficSignals(tags)) {
                        addToType = 'trafficSignals';
                    } else if (isCrossing(tags)) {
                        addToType = 'crossing';
                    } else if (isRestaurant(tags)) {
                        addToType = 'food';
                    } else if (isTree(tags)) {
                        addToType = 'tree';
                    } else if (isPublicTransport(tags)) {
                        addToType = 'publicTransport';
                    } else if (isHotel(tags)) {
                        addToType = 'hotel';
                    } else if (isATM(tags)) {
                        addToType = 'atm';
                    } else if (isParking(tags)) {
                        addToType = 'parking';
                    } else {
                        // Other - uncomment to print
                        //console.log(node.tag);
                    }

                    // Add it
                    if (previous[addToType]) {
                        previous[addToType].push(node);
                    } else {
                        previous[addToType] = [node];
                    }
                }
            }
            return previous;
        }, {}
    );

    // Clean up traffic lights (only valid if we have 4 wayObjects to it...
/*
    var trafficSignals = globalMapData.nodesOfInterest.trafficSignals;
    if (trafficSignals) {
        for (var i = 0; i < trafficSignals.length; i++) {
            if (!trafficSignals[i].wayObjects || trafficSignals[i].wayObjects.length !== 4) {
                trafficSignals.splice(i, 1);
                i--;
            }
        }
    }
*/
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

    var entranceNodes = [];
    if (numberBeginningNodesOutside) {
        entranceNodes.push(nodes[0]);
    }
    if (numberEndNodesOutside) {
        entranceNodes.push(nodes[nodes.length - 1]);
    }

    return entranceNodes;
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
