/**
 * Created by kaimingyi on 2016/11/20.
 */
const fs = require('fs-promise');
var Promise = require("bluebird");
const zlib = require('zlib');
const path = require('path');
const glw = require('../gk-glwrap');
const math = require('gl-matrix');

var loader_osgjs = loader_osgjs || {};
module.exports = loader_osgjs;

loader_osgjs.binaryData = null;
loader_osgjs.currDir = null;

loader_osgjs.load = Promise.coroutine(function* (url, urlbin, callback) {

    loader_osgjs.currDir = path.dirname(url);

    let source = yield fs.readFile(url);

    if (source === null) {
        console.warn('error : ' + err);
        return;
    }

    let bin = yield fs.readFile(urlbin);

    if (bin === null) {
        console.warn('error : ' + err);
        return;
    }

    var typedArray = new Uint8Array( bin );

    // check magic number 1f8b
    if ( typedArray[ 0 ] === 0x1f && typedArray[ 1 ] === 0x8b ) {

        if ( !zlib ) {
            Notify.error( 'zlib init failed.' );
        }

        var zdec = new zlib.Gunzip( typedArray );
        var result = zdec.decompress();

        console.info("unziped bin data.");

        loader_osgjs.binaryData = result.buffer;
    }
    else
    {
        console.info("directed bin data.");

        loader_osgjs.binaryData = typedArray;
    }



    var text = source.toString();
    var res = yield loader_osgjs.parse(text);
    callback(res);
});

loader_osgjs.parse = Promise.coroutine(function* (test) {

    prevTex = new glw.createMaterialObject();

    let rootNode = JSON.parse(test);

    //console.info(rootNode['osg.Node']);
    Repo = {};
    yield loader_osgjs.prepareRepo(rootNode);
    console.info(Repo);
    return loader_osgjs.parseNode(rootNode);

});

var currMatrix = null;

var Repo = {};

loader_osgjs.prepareRepo = Promise.coroutine(function* (node) {



    for( let subnode in node )
    {
        let currObj = node[subnode];

        if(subnode === 'osg.StateSet') {
            let material = yield loader_osgjs.parseMaterial(currObj);
            //console.info(material);
            let uniqueid = currObj['UniqueID'];
            if(material != null)
            {
                console.info(uniqueid);
                Repo[uniqueid] = material;
            }
        }
        else {
            if(typeof currObj === 'object')
            {
                yield loader_osgjs.prepareRepo(currObj);
            }
        }
    }
});

loader_osgjs.parseNode = Promise.coroutine(function* (node) {

    var res = [];

    for( let subnode in node )
    {
        let currObj = node[subnode];

        if(subnode === 'osg.Geometry') {

            ret = yield loader_osgjs.parseGeometry(currObj);
            if(ret.vbo.length > 0)
            {
                res.push(ret);
            }

        }
        else {

            if(typeof currObj === 'object')
            {
                if( subnode == 'osg.MatrixTransform' )
                {
                    // push matrix
                    currMatrix = math.mat4.clone(currObj.Matrix);//currObj.Matrix;
                }
                res = res.concat( yield loader_osgjs.parseNode(currObj) );
            }
        }
    }

    return res;
});

loader_osgjs.parseGeometry = Promise.coroutine(function* (node) {

    let geometry = {};

    let iboNode = node['PrimitiveSetList'];
    let userDataNode = node['UserDataContainer'];
    let vboNode = node['VertexAttributeList'];
    let stateNode = node['StateSet'];

    if( iboNode !== undefined && vboNode !== undefined )
    {
        geometry.ibo = yield loader_osgjs.parseIbo(iboNode);
        geometry.vbo = yield loader_osgjs.parseVbo(vboNode, userDataNode, geometry.ibo.tristrip);
        if(stateNode && 'osg.StateSet' in stateNode)
        {
            let id = stateNode['osg.StateSet']['UniqueID'];
            geometry.mainMaterial = Repo[id];
        }
        geometry.worldmatrix = currMatrix;

        let minVert = [9999,9999,9999];
        let maxVert = [-9999,-9999,-9999];

        for( let i=0; i < geometry.vbo.length / (3 + 3 + 2); ++i )
        {
            let point = [ geometry.vbo[i * 8 + 0], geometry.vbo[i * 8 + 1], geometry.vbo[i * 8 + 2] ];

            minVert[0] = Math.min(minVert[0], point[0]);
            minVert[1] = Math.min(minVert[1], point[1]);
            minVert[2] = Math.min(minVert[2], point[2]);

            maxVert[0] = Math.max(maxVert[0], point[0]);
            maxVert[1] = Math.max(maxVert[1], point[1]);
            maxVert[2] = Math.max(maxVert[2], point[2]);
        }

        let center = [ (minVert[0] + maxVert[0]) * 0.5, (minVert[1] + maxVert[1]) * 0.5, (minVert[2] + maxVert[2]) * 0.5 ];

        let radius = math.vec3.length( [maxVert[0] - minVert[0], maxVert[1] - minVert[1], maxVert[2] - minVert[2]] );

        geometry.center = center;
        geometry.radius = radius;
    }

    return geometry;
});


loader_osgjs.parseMaterial = Promise.coroutine(function* (attribs) {

    let retMat = null;

    let material = null;

    if( 'AttributeList' in attribs )
    {
        material = attribs['AttributeList'][0]['osg.Material'];
    }
    else
    {
        material = attribs;
    }
    if(material !== null && material['Name'])
    {
        let name = material['Name'];
        name += '.mat';

        try {
            fs.accessSync(path.join(loader_osgjs.currDir, name), fs.F_OK);

            let buffer = yield fs.readFile( path.join(loader_osgjs.currDir, name) );
            if(buffer)
            {
                let matnode = JSON.parse( buffer.toString() );

                if(matnode)
                {
                    retMat = glw.createMaterialObject();
                    for( let channel in matnode.channels)
                    {
                        let channelnode = matnode.channels[channel];
                        if( channelnode.texture )
                        {
                            let image = channelnode.texture.image;
                            let name = image.name;
                            let images = image.images;

                            let toplodurl = '';
                            let maxWidth = 0;
                            for( let i=0; i < images.length; ++i)
                            {
                                let currImage = images[i];
                                if( currImage.width > maxWidth )
                                {
                                    maxWidth = currImage.width;
                                    toplodurl = currImage.url;
                                }
                            }
                            //console.info(toplodurl);
                            let ext = path.extname(toplodurl);
                            let finalname = name + ext;

                            //console.info(finalname);

                            if( channel == 'DiffuseColor' )
                            {
                                retMat.mainTexPath = path.join( loader_osgjs.currDir, finalname );
                            }

                            if( channel == 'AOPBR' )
                            {
                                retMat.lightMapTexPath = path.join( loader_osgjs.currDir, finalname);
                            }

                            if( channel == 'Opacity' )
                            {
                                retMat.opacityMapTexPath = path.join( loader_osgjs.currDir, finalname);
                            }
                        }
                    }

                    if( retMat.opacityMapTexPath === undefined )
                    {
                        retMat.opacityMapTexPath = 'res/texture/white.jpg';
                    }
                }
            }

        } catch (e) {

        }
        return retMat;
    }
    return retMat;
});
    const IMPLICIT_HEADER_PRIMITIVE_LENGTH = 0;
const IMPLICIT_HEADER_MASK_LENGTH = 1;
const IMPLICIT_HEADER_EXPECTED_INDEX = 2;
const IMPLICIT_HEADER_LENGTH = 3;

/**
 * 恢复成delta表示的
 * @param t {Uint32Array}
 * @param off {number}
 */
function undelta(t, off){
    //第一个是1， 第二个是0， 所以从 a=i+1 开始， 例如 1,0,0,0,0
    for (var i = off || 0, r = t.length, n = t[i], a = i + 1; r > a; ++a) {
        var s = t[a];
        n = t[a] = n + (s >> 1 ^ -(1 & s));
    }
    return t;
}

/**
 * @param t {Uint32Array}  解开后的原始数据
 * @param e {Uint16Array}  解码输出数据
 * @param r {number} 偏移。例如 472 =  o.IMPLICIT_HEADER_LENGTH + n[o.IMPLICIT_HEADER_MASK_LENGTH] = 3+469
 * @param n {Object} 没用先
 */
function decodeIdex(t, e, r, n){
    var a = t[IMPLICIT_HEADER_EXPECTED_INDEX];    //0
    var s = t[IMPLICIT_HEADER_MASK_LENGTH];       // 469
   // console.info('a: ' + a + ' s:' + s);
    var o = new Uint32Array(t.subarray(IMPLICIT_HEADER_LENGTH, s + IMPLICIT_HEADER_LENGTH));//o是去掉头和mask之后的
    var u = 32 * s - e.length;
    //mask次循环
    for (var l = 1 << 31, h = 0; s > h; ++h){
        //32次循环
        for (var c = o[h], d = 32, p = h * d, f = h === s - 1 ? u : 0, g = f; d > g; ++g,++p){
            c & l >>> g ? e[p] = t[r++] : e[p] = n ? a : a++;
            //console.info(e);
        }

    }
    return e;
}

/**
 * @param t {Uint32Array}  解开后的原始数据
 * @param e elment size
 * @param i 解码后的实际index索引
 */
function decodeVert(t,e,i){
    var r=t.length/e;               //452 个顶点
    var n=new Uint8Array(r);
    var    a=i.length-1;
        n[i[0]]=1,                  //第一个三角形的顶点，标记为不解码
        n[i[1]]=1,
        n[i[2]]=1;

    // 2 - a
    for(var s=2;a>s;++s){           //从第2 - a个索引开始，对源顶点进行处理

        var o=s-2;
        var u=i[o];                 //第0索引
        var l=i[o+1];               //第1索引
        var h=i[o+2];               //第2索引
        var c=i[o+3];               //第3索引

        // 这个顶点的xyz分别处理
        if(1!==n[c]){
            n[c]=1,u*=e,l*=e,h*=e,c*=e;
            // x,y,z， 用0,1，2,3个索引对应的顶点值来合并， v3 = v3 + v1 + v2 + v0
            for(var d=0;e>d;++d)
                t[c+d]=t[c+d]+t[l+d]+t[h+d]-t[u+d];
        }
    }
    return t;
}

var i=1.57079632679,
    r=6.28318530718,n=3.14159265359,a=.01745329251,s=.25,o=720,u=832,l=47938362584151635e-21,
    h={};
//Processor_a(sourceData,new Float32Array(3*d),3,i.epsilon,i.nphi)
function decodeNormal(t,e,c,d,p,f)
{
    d=d||s,
        p=p||o;
    var g=Math.cos(d*a),
        m=0,
        v=0,
        _=h.table;
    if(void 0===_)
        for(v=(p+1)*(u+1)*3,_=h.table=new Float32Array(v),m=0;v>m;++m)
            _[m]=1/0;
    var b=n/(p-1),x=i/(p-1),A=f?3:2;
    for(m=0,v=t.length/A;v>m;++m){
        var y=m*c,S=m*A,C=t[S],M=t[S+1];
        4!==c||f||(e[y+3]=1024&C?-1:1,C&=-1025);
        var w,T,E,I=3*(C+p*M);
        if(w=_[I],w===1/0){
            var N=C*b,D=Math.cos(N),F=Math.sin(N);N+=x;
            var k=(g-D*Math.cos(N))/Math.max(1e-5,F*Math.sin(N));
            k>1?k=1:-1>k&&(k=-1);
            var R=M*r/Math.ceil(n/Math.max(1e-5,Math.acos(k)));
            w=_[I]=F*Math.cos(R),T=_[I+1]=F*Math.sin(R),E=_[I+2]=D
        }else
            T=_[I+1],E=_[I+2];
        if(f){
            var P=t[S+2]*l,L=Math.sin(P);e[y]=L*w,e[y+1]=L*T,e[y+2]=L*E,e[y+3]=Math.cos(P)
        }else
            e[y]=w,e[y+1]=T,e[y+2]=E}
    return e;
};

function dd(t, o, i) {
    for (var r = i[0], n = t.length, a = 0; n > a; ++a) {
        var s = r - t[a];
        o[a] = s,
        s >= r && (r = s + 1);
    }
    return i[0] = r,o;
}

var gIdx = [0];
/**
 * @param buff {Uint8Array} 数据
 * @return {Uint16Array} 顶点索引
 */
function decodePrimIndex_varint(buff, offset, len){
    gIdx = [0];
    var u32dt = varintToUInt32(buff,offset,len);

    // undelta
    var idxDtOff = IMPLICIT_HEADER_LENGTH+u32dt[IMPLICIT_HEADER_MASK_LENGTH];
    u32dt = undelta(u32dt, idxDtOff);

    // decode to target length
    var oo = new Uint16Array(u32dt[IMPLICIT_HEADER_PRIMITIVE_LENGTH]);//这里是有多少个index
    var d1 = decodeIdex(u32dt,oo,IMPLICIT_HEADER_LENGTH+u32dt[IMPLICIT_HEADER_MASK_LENGTH],1);

    // unwatermark
    dd(d1,d1,gIdx);

    // out
    return d1;
}

function decodeListIndex_varint(buff, offset, len){
    var u32dt = varintToUInt32(buff,offset,len);
    var idxDtOff = 0;
    u32dt = undelta(u32dt, idxDtOff);
    dd(u32dt,u32dt,gIdx);
    return u32dt;
}

function varintToUInt32(u8buff, offset, sz){
    var ret = new Uint32Array(sz);
    for(var s=offset,a=0; a!=sz;){
        var o=0,u=0;
        do{
            o |= (0x7f & u8buff[s])<<u;
            u+=7;
        }while(0!==(0x80 & u8buff[s++]));
        ret[a++]=o;
    }
    return ret;
}

function varintToInt32(u8buff, offset, sz){

    let ret = [];

    for(var s=offset,a=0; a!=sz;) {
        var value = 0,
            shift = 0,
            octet = 0;
        do {
            octet = u8buff[s++];
            if (shift < 32)
                value |= (octet & 127) << shift;
            shift += 7;
        } while (octet & 128);
        value = value & 1 ? (value+1) / -2 : value / 2;
        ret[a++] = value;
    }
    return ret;
}

loader_osgjs.parseIbo = Promise.coroutine(function* (node) {

    let ibos = {};

    node.forEach( currObj => {
    //let currObj = node[0];
        // multi indice
        let ibo = [];

        let topology = 'UNKNWON';
        for( let elementUnit in currObj)
        {
            let unitObj = currObj[elementUnit];

            topology =  unitObj['Mode'];
            let indiceData = unitObj['Indices'];



            if( topology == 'TRIANGLE_STRIP' && indiceData !== undefined ) {

                let nodeArray = indiceData['Array'];

                let type = Object.keys(nodeArray)[0];
                let nodeData = nodeArray[type];
                let size = nodeData['Size'];
                let offset = nodeData['Offset'];
                let itemSize = indiceData['ItemSize'];
                if( nodeData["File"] !== "model_file.bin.gz" )
                {
                    continue;
                }

                let i32 = decodePrimIndex_varint(loader_osgjs.binaryData, offset, size * itemSize);

                for( let i=0; i < i32.length; ++i)
                {
                    ibo.push( i32[i] );
                }
            }
            else if( topology == 'TRIANGLES' && indiceData !== undefined ) {
                let nodeArray = indiceData['Array'];

                let type = Object.keys(nodeArray)[0];
                let nodeData = nodeArray[type];
                let size = nodeData['Size'];
                let offset = nodeData['Offset'];
                let itemSize = indiceData['ItemSize'];
                if( nodeData["File"] !== "model_file.bin.gz" )
                {
                    continue;
                }

                let i32 = decodeListIndex_varint(loader_osgjs.binaryData, offset, size * itemSize);
                //let i32 = varintToUInt32(loader_osgjs.binaryData, offset, size * itemSize);
                //i32 = undelta(i32, 0);
                //console.info(i32);
                for( let i=0; i < i32.length; ++i)
                {
                    ibo.push( i32[i] );
                }
            }
        }

        if(topology === 'TRIANGLE_STRIP')
        {
            ibos.tristrip = ibo;
        }
        else if(topology === 'TRIANGLES')
        {
            ibos.trilist = ibo;
        }


    } );

    return ibos;
});

loader_osgjs.parseVbo = Promise.coroutine(function* (node, userDataNode, targetIbo ) {

    let vbo = [];
    //return vbo;
    let position = [];
    let normal = [];
    let texcoord = [];

    let vtx_bbl = [];
    let vtx_h = [];

    let uv0_bbl = [];
    let uv0_h = [];

    let epsilon = 0;
    let nphi = 0;

    let valueArray = userDataNode.Values;

    //console.info( valueArray );

    valueArray.forEach( item => {

        switch(item['Name'])
        {
            case 'vtx_bbl_x':
                vtx_bbl[0] = parseFloat(item['Value']);
                break;
            case 'vtx_bbl_y':
                vtx_bbl[1] = parseFloat(item['Value']);
                break;
            case 'vtx_bbl_z':
                vtx_bbl[2] = parseFloat(item['Value']);
                break;
            case 'vtx_h_x':
                vtx_h[0] = parseFloat(item['Value']);
                break;
            case 'vtx_h_y':
                vtx_h[1] = parseFloat(item['Value']);
                break;
            case 'vtx_h_z':
                vtx_h[2] = parseFloat(item['Value']);
                break;

            case 'uv_0_bbl_x':
                uv0_bbl[0] = parseFloat(item['Value']);
                break;
            case 'uv_0_bbl_y':
                uv0_bbl[1] = parseFloat(item['Value']);
                break;
            case 'uv_0_h_x':
                uv0_h[0] = parseFloat(item['Value']);
                break;
            case 'uv_0_h_y':
                uv0_h[1] = parseFloat(item['Value']);
                break;

            case 'epsilon':
                epsilon = parseFloat(item['Value']);
                break;
            case 'nphi':
                nphi = parseFloat(item['Value']);
                break;
        }
    } );

    function ParseVertexElement( targetNode, targetArray, bbl_target, h_target, iDxResult ) {

        if (targetNode !== undefined && targetNode.Array !== undefined) {

            let nodeArray = targetNode['Array'];
            let type = Object.keys(nodeArray)[0];
            let nodeData = nodeArray[type];

            let size = nodeData['Size'];
            let offset = nodeData['Offset'];
            let itemSize = targetNode['ItemSize'];
            if (nodeData["File"] === "model_file.bin.gz") {

                if(type != 'Float32Array')
                {
                    //console.info('buffer: ' + size + ' x ' + itemSize + ' start from ' + offset);
                    let i32 = varintToInt32(loader_osgjs.binaryData, offset, size * itemSize);
                    if(iDxResult !== undefined)
                    {
                        decodeVert(i32, itemSize, iDxResult);
                    }

                    for( let i=0; i < size; ++i)
                    {
                        for( let d=0; d < itemSize; ++d)
                        {
                            if(bbl_target !== null)
                            {
                                targetArray.push( bbl_target[d] + i32[i * itemSize + d] * h_target[d] );
                            }
                            else
                            {
                                targetArray.push( i32[i * itemSize + d]);
                            }
                        }
                    }
                }
                else
                {
                    let f32 = new Float32Array(loader_osgjs.binaryData.buffer, offset, size * itemSize);
                    //decodeVert(f32, itemSize, iDxResult);
                    for( let i=0; i < f32.length; ++i)
                    {
                        targetArray.push( f32[i] );
                    }
                    //console.info('length: ' + size * itemSize + ' | ' + f32.length);
                    //console.info(targetArray);
                }

            }
        }
    }

    function ParseNormalElement( targetNode, targetArray, epsilon, phi ) {

        if (targetNode !== undefined && targetNode.Array !== undefined) {

            let nodeArray = targetNode['Array'];
            let type = Object.keys(nodeArray)[0];
            let nodeData = nodeArray[type];

            let size = nodeData['Size'];
            let offset = nodeData['Offset'];
            let itemSize = targetNode['ItemSize'];
            if (nodeData["File"] === "model_file.bin.gz") {

                //console.info('buffer: ' + size + ' x ' + itemSize + ' start from ' + offset);
                let i32 = varintToUInt32(loader_osgjs.binaryData, offset, size * itemSize);
                //sourceData,new Float32Array(3*d),3,i.epsilon,i.nphi
                let normals = decodeNormal(i32, new Float32Array(3*size),3,epsilon,phi);
                //console.info(normals);
                for(let i = 0; i < normals.length; ++i) {
                    targetArray.push(normals[i]);
                }
            }
        }
    }

    //console.info( vtx_bbl );

    ParseVertexElement(node['Vertex'], position, vtx_bbl, vtx_h, targetIbo);
    ParseVertexElement(node['TexCoord0'], texcoord, uv0_bbl, uv0_h, targetIbo);
    ParseNormalElement(node['Normal'], normal, epsilon, nphi);
    //ParseVertexElement(node['TexCoord0'], texcoord, uv0_bbl, uv0_h);

    //console.info(position);
    //console.info(texcoord);

    for( let i = 0; i < position.length / 3; ++i )
    {
        // vbo.push( position[i * 3 + 0]);
        // vbo.push( position[i * 3 + 1]);
        // vbo.push( position[i * 3 + 2]);

        vbo.push( position[i * 3 + 0] );
        vbo.push( position[i * 3 + 1] );
        vbo.push( position[i * 3 + 2] );

        vbo.push( normal[i * 3 + 0]);
        vbo.push( normal[i * 3 + 1]);
        vbo.push( normal[i * 3 + 2]);

        vbo.push( texcoord[i * 2 + 0]);
        vbo.push( 1.0 - texcoord[i * 2 + 1]);
        //vbo.push( normal[i * 3 + 0] );
        //vbo.push( normal[i * 3 + 1] );
        //vbo.push( normal[i * 3 + 2] );

        //vbo.push( texcoord[i * 2 + 0] );
        //vbo.push( texcoord[i * 2 + 1] );
    }



    return vbo;
});