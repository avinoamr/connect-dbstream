var events = require( "events" );
var extend = require( "extend" );
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
            ( req.params.id && req.method == "PATCH" )       ? patch  :
            ( req.params.id && req.method == "DELETE" )      ? remove : null;

        if ( !action ) {
            res.error = "Bad Request";
            mw.emit( "error", req, res );
            res.writeHead( 400, res.error );
            res.end();
            return
        }

        try {
            action( mw, req, res );
        } catch ( err ) {
            on_error( mw, req, res )( err );
        }
    }

    mw.conn = connection;
    events.EventEmitter.call( mw );
    mw.__proto__ = Object.create( events.EventEmitter.prototype );


    var before = {};
    var after  = {};
    mw.before = function ( name, fn ) {
        before[ name ] = fn;
        return mw;
    }
    mw.after = function ( name, fn ) {
        after[ name ] = fn;
        return mw;
    }

    mw.doBefore = function ( name, req, res, next ) {
        if ( !before[ name ] ) return next();
        before[ name ]( req, res, next );
    }

    mw.doAfter = function ( name, req, res, next ) {
        if ( !after[ name ] ) return next();
        after[ name ]( req, res, next );
    }
    
    // at least one error handler should be bound to the `error` event in order to 
    // avoid propagation of errors
    return mw.on( "error", function ( req, res ) {
        console.error( res.error );
    });
}

module.exports.session = function ( session, connection ) {
    var store = new session.Store();
    store.get = function ( sid, callback ) {
        var found;
        new connection.Cursor()
            .find({ id: sid })
            .on( "data", function ( obj ) { found = JSON.parse( obj.v ) })
            .on( "end", function () { callback( null, found ) })
            .on( "error", callback )
    };
    store.set = function ( sid, session, callback ) {
        var obj = { id: sid, v: JSON.stringify( session ) }
        var cursor = new connection.Cursor()
            .on( "finish", callback )
            .on( "error", callback );
        cursor.write( obj );
        cursor.end();
    };
    store.destroy = function ( sid, callback ) {
        var cursor = new connection.Cursor()
            .on( "finish", callback )
            .on( "error", callback );
        cursor.remove( { id: sid } );
        cursor.end();
    };
    return store;
}

function search ( mw, req, res ) {
    var acc = [];
    mw.doBefore( "search", req, res, function () {
        var limit = req.query[ "$limit" ];
        delete req.query[ "$limit" ];
        new mw.conn.Cursor()
            .find( req.query )
            .limit( limit )
            .on( "error", on_error( mw, req, res ) )
            .on( "data" , function ( obj ) {
                acc.push( obj );
            })
            .on( "end", function() {
                res.data = acc;
                mw.doAfter( "search", req, res, function () {
                    res.end( JSON.stringify( res.data ) );
                })
            });
    })
};

function read ( mw, req, res ) {
    var found = false;
    mw.doBefore( "read", req, res, function () {
        new mw.conn.Cursor()
            .find({ id: req.params.id })
            .on( "error", on_error( mw, req, res ) )
            .once( "data", function ( obj ) {
                found = true;
                res.data = obj;
                mw.doAfter( "read", req, res, function () {
                    res.end( JSON.stringify( res.data ) );
                })
            })
            .on( "end", function () {
                if ( found ) return;
                res.writeHead( 404, "Not Found" );
                res.end();
            });
    })
};

function create ( mw, req, res ) {
    mw.doBefore( "update", req, res, function () {
        var cursor = new mw.conn.Cursor();
        cursor.write( req.body );
        cursor
            .on( "error", on_error( mw, req, res ) )
            .on( "finish", function() {
                res.data = req.body;
                mw.doAfter( "update", req, res, function () {
                    res.end( JSON.stringify( res.data ) );
                })
            })
            .end();
    })
};

function update ( mw, req, res ) {
    var cursor = new mw.conn.Cursor();
    req.body.id = req.params.id;
    create( mw, req, res );
};

function patch ( mw, req, res ) {
    var found = false;
    var cursor = new mw.conn.Cursor()
        .find({ id: req.params.id })
        .on( "error", on_error( mw, req, res ) )
        .once( "data", function ( obj ) {
            found = true;
            res.data = extend( obj, req.body );
            mw.doBefore( "patch", req, res, function () {
                cursor.on( "finish", function () {
                    mw.doAfter( "patch", req, res, function () {
                        res.end( JSON.stringify( res.data ) );
                    })
                })
                .end( res.data );
            })
        })
        .on( "end", function () {
            if ( found ) return;
            res.writeHead( 404, "Not Found" );
            res.end();
        })

}

function remove ( mw, req, res ) {
    mw.doBefore( "remove", req, res, function () {
        var cursor = new mw.conn.Cursor();
        cursor.remove({ id: req.params.id });
        cursor
            .on( "error", on_error( mw, req, res ) )
            .on( "finish", function() {
                res.data = {};
                mw.doAfter( "remove", req, res, function () {
                    res.end( JSON.stringify( res.data ) );
                })
            })
            .end();
    })
}

function on_error ( mw, req, res ) {
    return function ( err ) {
        res.error = err;
        mw.emit( "error", req, res );
        res.writeHead( 500, "Internal Server Error" );
        res.write( res.error.toString() );
        res.end();
    }
}

