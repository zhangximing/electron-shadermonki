'use strict';

var renderer = renderer || {};

renderer.quadIBO = null;
renderer.quadVBO = null;
renderer.quadMesh = null;
renderer.quadProgram = null;
renderer.timer = 0;


renderer.init = function() {

    // abs time of start
    this.timer = Date.now();

    // test for quad vertex data
    var quadPosition = [
        -0.7,  0.7,  0.0,       0.0, 0.0,
        0.7,  0.7,  0.0,        0.0, 1.0,
        -0.7, -0.7,  0.0,       1.0, 0.0,
        0.7, -0.7,  0.0,        1.0, 1.0,
    ];

    var quadIndex = [
        0, 1, 2, 2, 1, 3
    ];

    // resource object
    this.quadMesh = glw.createMeshObject(quadPosition, quadIndex, [glw.VERTEX_LAYOUT_P]);
    this.quadProgram = glw.createProgramObject(vsp, fsp);//glw._create_program(vs, ps);
    if(this.quadProgram == null)
    {
        console.warn('program create failed.');
    }
}

renderer.render = function() {

    var runTime = Date.now() - this.timer;

    // clear with a red color
    glw.clear([0.7, 0.1, 0.1, 1.0], 1.0);
    glw.viewport(0,0,glw.canvas.width, glw.canvas.height);

    // simple draw a quad
    this.quadProgram.use();

    //console.info(runTime);
    glw.set_uniform1f("_TIME", runTime * 0.001);

    this.quadMesh.bind();
    this.quadMesh.draw();
    //glw.bind_draw_buffer(this.quadVBO, this.quadIBO);
    //glw.draw_elements(glw.gl.TRIANGLES, 2*3);

}

var vsp = "attribute vec3 position;\
varying vec2 vTexCoord;\
void main(){\
    vTexCoord = ((position + 1.0) * 0.5).xy;\
    gl_Position = vec4(position, 1.0);\
}\
";

var fsp = "precision mediump float;\
uniform sampler2D texture;\
varying vec2 vTexCoord;\
uniform float _TIME;\
float frac(float t)\
{\
    return t - floor(t);\
}\
void main(){\
    vec4 samplerColor = vec4(frac(vTexCoord.x + _TIME),frac(vTexCoord.y + _TIME),0,1);\
    gl_FragColor = samplerColor;\
}\
";

/**
 * Created by kaimingyi on 2016/11/7.
 */