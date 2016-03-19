var globalMapData = {};
var resolution = 1000;

function parseMapData() {
    var data = window.mapData;
    globalMapData.bounds = {
        minX: data.bounds[0].$.minlon,
        maxX: data.bounds[0].$.maxlon,
        maxY: data.bounds[0].$.minlat, // Shift min and max here
        minY: data.bounds[0].$.maxlat
    };

    var nodes = {};
    for (var nodeIndex = 0; nodeIndex < data.node.length; nodeIndex++) {
        var node = data.node[nodeIndex];
        nodes[node.$.id] = node;
    }
    globalMapData.nodes = nodes;
    globalMapData.ways = data.way;
    globalMapData.relations = data.relation;

    initCanvas();
}

function initCanvas() {
    var width = resolution;
    var height = resolution;

    var calculateRatioX = 37.0;
    var calculateRatioY = 21.0;
    var widthPctOfHeight = (Math.abs(globalMapData.bounds.maxX - globalMapData.bounds.minX) / calculateRatioX) / (Math.abs(globalMapData.bounds.maxY - globalMapData.bounds.minY) / calculateRatioY);
    var canvas = document.querySelector('canvas');
    if (widthPctOfHeight > 1) {
        height = resolution / widthPctOfHeight;
    } else {
        width = resolution / widthPctOfHeight;
    }

    var scene = new THREE.Scene();
    //var camera = new THREE.PerspectiveCamera(globalMapData.bounds.maxX - globalMapData.bounds.minX, width / height, 0.1, 1000);
    var camera = new THREE.OrthographicCamera(globalMapData.bounds.minX, globalMapData.bounds.maxX, globalMapData.bounds.minY, globalMapData.bounds.maxY, 0.1, 1000);
    camera.position.z = 50;

    var renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);


    addWays(scene);

    //var render = function () {
    //    requestAnimationFrame(render);
    //
    //    cube.rotation.x += 0.1;
    //    cube.rotation.y += 0.1;
    //
    //    renderer.render(scene, camera);
    //};
    //
    //render();
    renderer.render(scene, camera);
}

function addWays(scene) {
    var whiteMaterial = new THREE.MeshBasicMaterial({color: 0xffffff});

    var ways = globalMapData.ways;
    for (var i = 0; i < ways.length; i++) {
        var way = ways[i];
        if (way.tag && way.tag.highway === 'residential') {
            var previousNode = getNode(way.nd[0].$.ref);
            for (var j = 1; j < way.nd.length; j++) {
                var currentNode = getNode(way.nd[j].$.ref);
                var positionData = getPositionData(previousNode.$.lon, previousNode.$.lat, currentNode.$.lon, currentNode.$.lat);

                // Create the part of the road
                var geometry = new THREE.BoxGeometry(positionData.l, 10, 0.0); // Y should be way size
                var cube = new THREE.Mesh(geometry, whiteMaterial);
                cube.position.x = positionData.x;
                cube.position.y = positionData.y;
                cube.rotation.z = positionData.r;
                scene.add(cube);

                previousNode = currentNode;
            }
        }
    }
}

function getNode(id) {
    return globalMapData.nodes[id];
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
