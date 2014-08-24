var events = require( "events" );
var url = require( "url" );
module.exports = function ( connection ) {
    var mw = function ( req, res, next ) {
        var purl = url.parse( req.url, true );
        req.params || ( req.params = {} );
        req.query || ( req.query = purl.query );
        req.params.id = purl.pathname.substr( 1 ).trim();
        var action =
            ( purl.pathname == "/" && req.method == "GET" )  ? search :
            ( purl.pathname == "/" && req.method == "POST" ) ? update :
            ( req.params.id && req.method == "GET" )         ? read :
            ( req.params.id && req.method == "PUT" )         ? update :
            // ( req.params.id && req.method == "PATCH" )       ? patch  :
            ( req.params.id && req.method == "DELETE" )      ? remove : null;

        if ( !action ) {
            res.error = "Bad Request";
            mw.emit( "error", req, res );
            res.writeHead( 400, res.error );
            res.end();
            return
        }

        action( mw, req, res );
    }

    mw.conn = connection;
    events.EventEmitter.call( mw );
    mw.__proto__ = Object.create( events.EventEmitter.prototype );
    return mw;
}

function search ( mw, req, res ) {
    var acc = [];
    mw.emit( "search:before", req, res );
    new mw.conn.Cursor()
        .find( req.query )
        .on( "error", on_error( mw, req, res ) )
        .on( "data" , function ( obj ) {
            acc.push( obj );
        })
        .on( "end", function() {
            res.data = acc;
            mw.emit( "search:after", req, res );
            res.end( JSON.stringify( res.data ) );
        });
};

function read ( mw, req, res ) {
    var found = false;
    mw.emit( "read:before", req, res );
    new mw.conn.Cursor()
        .find({ id: req.params.id })
        .on( "error", on_error( mw, req, res ) )
        .once( "data", function ( obj ) {
            found = true;
            res.data = obj;
            mw.emit( "read:after", req, res );
            res.end( JSON.stringify( res.data ) );
        })
        .on( "end", function () {
            if ( !found ) {
                res.writeHead( 404, "Not Found" );
            }
            res.end();
        });
};

function create ( mw, req, res ) {
    var cursor = new mw.conn.Cursor();
    mw.emit( "update:before", req, res );
    cursor.write( req.body );
    cursor
        .on( "error", on_error( mw, req, res ) )
        .on( "finish", function() {
            res.data = req.body;
            mw.emit( "update:after", req, res );
            res.end( JSON.stringify( res.data ) );
        })
        .end();
};

function update ( mw, req, res ) {
    var cursor = new mw.conn.Cursor();
    req.body.id = req.params.id;
    create( mw, req, res );
};

function remove ( mw, req, res ) {
    var cursor = new mw.conn.Cursor();
    mw.emit( "remove:before", req, res );
    cursor.remove({ id: req.params.id });
    cursor
        .on( "error", on_error( mw, req, res ) )
        .on( "finish", function() {
            res.data = {};
            mw.emit( "remove:after", req, res );
            res.end( JSON.stringify( res.data ) );
        })
        .end();
}

function on_error ( mw, req, res ) {
    return function ( err ) {
        res.error = err;
        mw.emit( "error", req, res );
        res.writeHead( 500, "Internal Server Error" );
        res.end();
    }
}

