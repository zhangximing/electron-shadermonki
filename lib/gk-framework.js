/**
 * Created by gameKnife on 2016/12/1.
 */
'use strict';
const gTimer            = require("./gk-timer.js");
const Fabricate         = require("./fabricate.js");

const gkCore            = require("./gk-core.js");
const acEditor          = require('./gk-acewrap');
const glw               = require("./gk-glwrap");

class Framework
{
    constructor() {

    }

    init() {

    }

    update() {

    }

    destroy() {

    }
}

class ShaderMonkiFramework extends Framework
{
    constructor() {
        super();

        this.renderer = null;
        this.sceneMgr = null;

        this.mainCamera = null;


        this.modelrotation = 0;
        this.camerarotationx = 0;
        this.camerarotationy = 0;

        this.camerapanx = 0;
        this.camerapany = 0;

        this.autoRotate = false;

        this.vsp_source = null;
        this.fsp_source = null;

        this.holderGameObject = null;

        this.cameraCenter = gkCore.math.vec3.create();
        this.cameraRadius = 500.0;
    }

    init() {
        gTimer.init();

        this.renderer = gkCore.renderer;
        this.renderer.init();

        this.sceneMgr = gkCore.sceneMgr;
        this.sceneMgr.init();

        this.mainCamera = Fabricate(gkCore.GameObject.Camera);
        this.mainCamera.transform.parent = this.sceneMgr.getSceneRoot().transform;

        // temporary camera transform setting
        this.mainCamera.transform.position = gkCore.math.vec3.fromValues(0,15,50);
        this.mainCamera.transform.lookAt( gkCore.math.vec3.fromValues(0,0,0) );

        this.mainLight = Fabricate(gkCore.GameObject.Light);
        this.mainLight.transform.position = gkCore.math.vec3.fromValues(-1000,1500,1000);
        this.mainLight.transform.lookAt( gkCore.math.vec3.fromValues(0,0,0) );
        this.mainLight.transform.parent = this.sceneMgr.getSceneRoot().transform;

        // create editor
        let refthis = this;

        let vseditor = new acEditor.AceEditorWindow("vs-editor-panel");
        vseditor.setChangeCallback( function(str) {
            refthis.vsp_source = str;
            refthis.updateShader();
        } )

        let fseditor = new acEditor.AceEditorWindow("fs-editor-panel");
        fseditor.setChangeCallback( function(str) {
            refthis.fsp_source = str;
            refthis.updateShader();
        } );

        // default assets loading
        vseditor.loadFile('res/shader/base_vs.glsl');
        fseditor.loadFile('res/shader/base_fs.glsl');

    }

    update() {
        gTimer.update();

        // update mouse
        let relDelta = gkCore.mouse.frameUpdate();

        if(gkCore.mouse.moveType === gkCore.mouse.HOLDLEFT)
        {
            this.camerarotationy -= relDelta.y * 0.005;
            this.camerarotationx -= relDelta.x * 0.005;
        }
        else if(gkCore.mouse.moveType === gkCore.mouse.HOLDMIDDLE)
        {
            this.camerapany += relDelta.y * (0.002 * this.cameraRadius);
            this.camerapanx -= relDelta.x * (0.002 * this.cameraRadius);
        }

        this.cameraRadius *= (1.0 - relDelta.z * 0.25);

        let rot = gkCore.math.quat.create();
        gkCore.math.quat.rotateY(rot, rot, this.camerarotationx);
        gkCore.math.quat.rotateX(rot, rot, this.camerarotationy);
        this.mainCamera.transform.rotation = rot;
        this.mainCamera.transform.position = this.cameraCenter;
        this.mainCamera.transform.translateLocal(gkCore.math.vec3.fromValues(this.camerapanx,this.camerapany,0));
        this.mainCamera.transform.translateLocal(gkCore.math.vec3.fromValues(0,0,this.cameraRadius));

        this.sceneMgr.update();
        this.renderer.render();
    }

    destory() {

    }

    updateShader() {
        if(this.vsp_source !== null && this.fsp_source !== null && this.vsp_source !== "" && this.fsp_source !== "") {
            let program = glw.createProgramObject(this.vsp_source, this.fsp_source);
            this.renderer.overrideProgram = program;
        }
    }

    bindShowObj( gameObject) {

        // load a mesh into gameobject struct
        if(this.holderGameObject !== null)
        {
            this.holderGameObject.transform.parent = null;
        }
        // bind it to scene root
        gameObject.transform.parent = gkCore.sceneMgr.getSceneRoot().transform;
        this.holderGameObject = gameObject;

        // camera target reset
        let mrs = gameObject.transform.getComponent( gkCore.Component.MeshRenderer );
        let aabbTotal = gkCore.mathext.aabb.create();
        mrs.forEach( meshRenderer => {
            let aabb = meshRenderer.bounds;
            gkCore.mathext.aabb.mergeAABB(aabbTotal, aabb);
        });

        this.cameraCenter = gkCore.mathext.aabb.center(gkCore.math.vec3.create(), aabbTotal);
        this.cameraRadius = gkCore.mathext.aabb.radius(aabbTotal) * 1.5;
        this.camerapanx = 0;
        this.camerapany = 0;

        //console.info(aabbTotal);
        if( isNaN( this.cameraCenter[0] ))
        {
            this.cameraCenter = gkCore.math.vec3.create();
            this.cameraRadius = 100.0;
        }

        console.info(this.cameraCenter);
        console.log(this.cameraRadius);
    }
}

module.exports = ShaderMonkiFramework;