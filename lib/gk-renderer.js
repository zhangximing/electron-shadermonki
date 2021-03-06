/**
 * Created by gameKnife on 2016/12/1.
 */
const glw = require("./gk-glwrap");
const fixedshader = require("./gk-fixedshader");
const resMgr = require("./gk-resmgr");
const math = require("gl-matrix");
const gTimer = require("./gk-timer");
const mouse = require("./gk-mouseorbit");


const GameObject = require("./gk-gameobject.js");
const Component = require("./gk-component.js");

class RenderQueue {
    constructor( _depth ) {
        this.depth = _depth;
        this.meshRenderers = [];

        // per queue uniform unit: { KEY: "_MVP", VALUE: mat4 / vec4 / etc }
        this.uniformPerQueue = new Map();

        this.camera = null;
        this.light = null;
    }

    setupCamera( cam ) {

        this.camera = cam;

    }

    setupLight( light ) {

        this.light = light;
    }

    clear() {
        this.meshRenderers = [];
    }

    addRenderer( mr ) {
        this.meshRenderers.push(mr);
    }

    sort() {
        // sort by material
    }

    prepare( rendererInst )
    {
        // prepare cam
        {
            let camts = this.camera.host.transform;

            let cameraPosition = camts.position;
            let cameraUpDirection = camts.up;
            let cameraForwardDirection = math.vec3.negate(math.vec3.create(), camts.forward);
            let centerPoint = math.vec3.add( math.vec3.create(), cameraPosition, cameraForwardDirection );

            let aspect = rendererInst.currentRenderTarget.width / rendererInst.currentRenderTarget.height;

            let projMatrix = math.mat4.perspective(math.mat4.create(), 45, aspect, 0.5, 5000.0);
            let viewMatrix = math.mat4.lookAt(math.mat4.create(), cameraPosition, centerPoint, cameraUpDirection);
            let vpMatrix = math.mat4.multiply(math.mat4.create(), projMatrix, viewMatrix);

            this.uniformPerQueue.set("_PROJ", projMatrix );
            this.uniformPerQueue.set("_VIEW", viewMatrix );
            this.uniformPerQueue.set("_VIEWPROJ", vpMatrix );
        }

        // prepare light
        {
            let lightDir = this.light.host.transform.forward;
            this.uniformPerQueue.set("_LIGHTDIR", lightDir);

            let camts = this.light.host.transform;

            let cameraPosition = camts.position;
            let cameraUpDirection = camts.up;
            let cameraForwardDirection = math.vec3.negate(math.vec3.create(), camts.forward);
            let centerPoint = math.vec3.add( math.vec3.create(), cameraPosition, cameraForwardDirection );

            let projMatrix = math.mat4.ortho(math.mat4.create(), -150, 150, -150, 150, 500, 3000);
            let viewMatrix = math.mat4.lookAt(math.mat4.create(), cameraPosition, centerPoint, cameraUpDirection);
            let vpMatrix = math.mat4.multiply(math.mat4.create(), projMatrix, viewMatrix);

            this.uniformPerQueue.set("_LIGHTPROJ", projMatrix );
            this.uniformPerQueue.set("_LIGHTVIEW", viewMatrix );
            this.uniformPerQueue.set("_LIGHTVIEWPROJ", vpMatrix );

            let vMatrixOfCam = this.uniformPerQueue.get("_VIEW");
            let cam2lightMtx = math.mat4.invert(math.mat4.create(), vMatrixOfCam);

            math.mat4.multiply(cam2lightMtx, vpMatrix, cam2lightMtx);

            this.uniformPerQueue.set("_CAM2LIGHTVIEWPROJ", cam2lightMtx );
        }

    }

    // func: param0 - renderer
    traverse( func, additionParam ) {

        for( let i=0, len = this.meshRenderers.length; i < len; ++i)
        {
            func( this.meshRenderers[i], this, additionParam );
        }
    }
}

// singleton
let instance = null;

class Renderer {
    constructor() {
        if(!instance){
            instance = this;

            this.bgMesh = null;
            this.bgProgram = null;
            this.noiseProgram = null;
            this.shadowmapProgram = null;
            this.zpassProgram = null;

            this.ssaoProgram = null;

            this.simBackBuffer = null;
            this.shadowMapBuffer = null;
            this.zpassFrameBuffer = null;

            this.overrideProgram = null;

            this.renderQueues = new Map();

            this.currentRenderTarget = null;
        }

        return instance;
    }

    init() {

        // initialize quad
        const quadPosition = [
            -1.0,  1.0,  1.0,   1.0, 0.0, 0.0,       0.0, 0.0,
            1.0,  1.0,  1.0,    1.0, 0.0, 0.0,       0.0, 1.0,
            -1.0, -1.0,  1.0,   1.0, 0.0, 0.0,       1.0, 0.0,
            1.0, -1.0,  1.0,    1.0, 0.0, 0.0,       1.0, 1.0,
        ];
        const quadIndex = [
            0, 1, 2, 2, 1, 3
        ];
        let res = null;
        let ibo = {};
        ibo.trilist =  quadIndex;
        res = {vbo: quadPosition, ibo: ibo };
        this.bgMesh = glw.createMeshObject(res, [glw.VERTEX_LAYOUT_P, glw.VERTEX_LAYOUT_T0, glw.VERTEX_LAYOUT_N]);

        // initialize shader
        this.bgProgram = glw.createProgramObject(fixedshader.quadvsp, fixedshader.quadfsp);
        this.noiseProgram = glw.createProgramObject(fixedshader.quadvsp, fixedshader.noisefsp);

        if( glw.glext_depth_texture )
        {
            this.shadowmapProgram = glw.createProgramObject(fixedshader.simpleshadowvsp, fixedshader.simpleshadowfsp);
        }
        else
        {
            this.shadowmapProgram = glw.createProgramObject(fixedshader.shadowvsp, fixedshader.shadowfsp);
        }

        this.zpassProgram = glw.createProgramObject(fixedshader.simplezpassvsp, fixedshader.simplezpassfsp);

        this.ssaoProgram = glw.createProgramObject(fixedshader.ssaovsp, fixedshader.ssaofsp);

        // initialize render texture
        this.shadowMapBuffer = resMgr.gResmgr.create_render_texture(1024,1024);
        this.shadowMapBuffer.load();

        this.resize(1024, 1024);

    }

    resize( width, height )
    {
        this.simBackBuffer = resMgr.gResmgr.create_render_texture(width * 2, height * 2);
        this.simBackBuffer.load();

        this.zpassFrameBuffer = resMgr.gResmgr.create_render_texture(width * 2, height * 2);
        this.zpassFrameBuffer.load();

        this.occlusionFrameBuffer = resMgr.gResmgr.create_render_texture(width * 2, height * 2);
        this.occlusionFrameBuffer.load();
    }

    pushRenderTarget( renderTexture )
    {
        this.currentRenderTarget = renderTexture;
        glw.gl.bindFramebuffer(glw.gl.FRAMEBUFFER, renderTexture.fbo);
        glw.viewport(0, 0,renderTexture.width, renderTexture.height);
    }

    popRenderTarget()
    {

    }

    render() {

        // render queue sorting
        for (let queue of this.renderQueues.values()) {
            queue.sort();
        }

        ///////////////////
        // shadow map gen
        this.pushRenderTarget(this.shadowMapBuffer);
        // clear with a grey color
        glw.clear([1, 1, 1, 1], 1.0);

        // set z enable
        glw.gl.enable(glw.gl.DEPTH_TEST);
        glw.gl.depthFunc(glw.gl.LEQUAL);
        glw.gl.disable(glw.gl.CULL_FACE);

        this.shadowmapProgram.use();

        for (let queue of this.renderQueues.values()) {
            queue.traverse( this.renderSingleRendererShadowmp );
        }


        ///////////////////
        // zpass
        this.pushRenderTarget(this.zpassFrameBuffer);
        // clear with a normal color
        glw.clear([0.5, 0.5, 1.0, 1.0], 1.0);

        // set z enable
        glw.gl.enable(glw.gl.DEPTH_TEST);
        glw.gl.depthFunc(glw.gl.LEQUAL);
        glw.gl.disable(glw.gl.CULL_FACE);

        // for every render queue
        if(this.zpassProgram != null)
        {
            this.zpassProgram.use();
        }

        for (let queue of this.renderQueues.values()) {

            queue.prepare( this );
            // setup queue basic parameter
            queue.traverse( this.renderSingleRenderer );
        }

        ///////////////////
        // occlusion pass

        // ssao
        this.pushRenderTarget(this.occlusionFrameBuffer);
        // clear with white color
        glw.clear([1.0, 1.0, 1.0, 1.0], 1.0);
        if(this.ssaoProgram != null) {
            this.ssaoProgram.use();
            glw.bind_texture( this.zpassFrameBuffer.gltextureobject, 5 );
            glw.bind_texture( this.zpassFrameBuffer.depth, 6 );
        }
        this.bgMesh.draw();

        ///////////////////
        // general shading pass

        // bind general draw ssaa fbo
        this.pushRenderTarget(this.simBackBuffer);
        // clear with a grey color
        glw.clear([0.15, 0.15, 0.15, 1.0], 1.0);

        // set z enable
        glw.gl.enable(glw.gl.DEPTH_TEST);
        glw.gl.depthFunc(glw.gl.LEQUAL);
        glw.gl.disable(glw.gl.CULL_FACE);

        // render the noising background
        this.noiseProgram.use();
        glw.set_uniform1f("_TIME", gTimer.runTime * 0.001);
        this.bgMesh.draw();

        // main render process

        // for every render queue
        if(this.overrideProgram != null)
        {
            this.overrideProgram.use();
        }

        for (let queue of this.renderQueues.values()) {

            queue.prepare( this );
            // setup queue basic parameter
            queue.traverse( this.renderSingleRenderer );
        }

        // bind backbuffer, resolve ssaa
        glw.gl.bindFramebuffer(glw.gl.FRAMEBUFFER, null );

        // clear with a grey color
        glw.clear([0.15, 0.15, 0.15, 1.0], 1.0);
        glw.viewport(0, 0, glw.canvas.width, glw.canvas.height);

        this.bgProgram.use();
        glw.set_uniform1f("_TIME", gTimer.runTime * 0.001);

        // bind the draw buffer
        glw.bind_texture( this.simBackBuffer.gltextureobject, 0 );

        // bind the zpass buffer
        //glw.bind_texture( this.occlusionFrameBuffer.gltextureobject, 0);

        this.bgMesh.draw();




        // render queue clear
        for (let queue of this.renderQueues.values()) {
            queue.clear();
        }
    }

    destroy() {

    }

    getOrCreateRenderQueue( depth ) {
        if( !this.renderQueues.has( depth ) )
        {
            this.renderQueues.set( depth, new RenderQueue( depth ));
        }

        return this.renderQueues.get( depth );
    }

    renderSingleRendererShadowmp( renderer, queue ) {
        if( renderer instanceof Component.MeshRenderer )
        {
            // grab matrix
            let vpMatrix = queue.uniformPerQueue.get("_LIGHTVIEWPROJ");

            //renderer.host.transform._localToWorldMatrx;
            let mMatrix = renderer.host.transform.localToWorldMatrix;

            // set material
            let mat = renderer.material;

            glw.bind_texture( mat.mainTex.gltextureobject, 0 );
            glw.bind_texture( mat.opacityMapTex.gltextureobject, 1 );

            glw.set_uniform4x4fv("_MVP", math.mat4.mul(math.mat4.create(), vpMatrix, mMatrix));
            glw.set_uniform4x4fv("_M2W", mMatrix);

            // extract meshfilter
            let mf = renderer.host.components.get(Component.MeshFilter);

            // render
            if( mf.mesh !== null ) {
                //console.info(mf.mesh);
                mf.mesh.draw();
            }
        }
    }

    renderSingleRenderer( renderer, queue ) {
        if( renderer instanceof Component.MeshRenderer )
        {
            // grab matrix
            let vpMatrix = queue.uniformPerQueue.get("_VIEWPROJ");
            let vMatrix = queue.uniformPerQueue.get("_VIEW");
            let vpMatrix_Light = queue.uniformPerQueue.get("_CAM2LIGHTVIEWPROJ");

            //renderer.host.transform._localToWorldMatrx;
            let mMatrix = renderer.host.transform.localToWorldMatrix;

            // set material
            let mat = renderer.material;

            let lightDir = queue.uniformPerQueue.get("_LIGHTDIR");
            if(lightDir)
            {
                lightDir[3] = 0;
                glw.set_uniform4f("_LIGHTDIR", lightDir);
            }

            glw.bind_texture( mat.mainTex.gltextureobject, 0 );
            glw.bind_texture( mat.opacityMapTex.gltextureobject, 1 );

            glw.bind_texture( instance.zpassFrameBuffer.gltextureobject, 5 );
            if(glw.glext_depth_texture)
            {
                glw.bind_texture( instance.zpassFrameBuffer.depth, 6 );
            }
            else
            {
                //glw.bind_texture( instance.shadowMapBuffer.gltextureobject, 6 );
            }

            if(glw.glext_depth_texture)
            {
                glw.bind_texture( instance.shadowMapBuffer.depth, 7 );
            }
            else
            {
                glw.bind_texture( instance.shadowMapBuffer.gltextureobject, 7 );
            }

            glw.set_uniform4x4fv("_MVP", math.mat4.mul(math.mat4.create(), vpMatrix, mMatrix));
            glw.set_uniform4x4fv("_MV", math.mat4.mul(math.mat4.create(), vMatrix, mMatrix));
            glw.set_uniform4x4fv("_M2W", mMatrix);

            glw.set_uniform4x4fv("_MVP_LIGHT",vpMatrix_Light);

            // extract meshfilter
            let mf = renderer.host.components.get(Component.MeshFilter);

            // render
            if( mf.mesh !== null ) {
                //console.info(mf.mesh);
                mf.mesh.draw();
            }
        }
    }
}

module.exports = Renderer;