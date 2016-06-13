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
            ( purl.pathname == "/" && req.method == "POST" ) ? create :
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
        if ( !before[ name ] ) {
            before[ name ] = [];
        }
        before[ name ].push( fn );
        return mw;
    }

    mw.after = function ( name, fn ) {
        if ( !after[ name ] ) {
            after[ name ] = [];
        }
        after[ name ].push( fn );
        return mw;
    }

    mw.doBefore = function ( name, req, res, next ) {
        walk( before[ name ], req, res, next );
    }

    mw.doAfter = function ( name, req, res, next ) {
        walk( after[ name ], req, res, next );
    }

    // invoke each handler in order
    function walk( handlers, req, res, done ) {
        if ( !handlers || !handlers.length ) {
            done();
            return
        }

        var next = handlers[ 0 ];
        var tail = handlers.slice( 1 );
        next( req, res, function ( err ) {
            if ( err ) {
                return on_error( mw, req, res )( err );
            }

            walk( tail, req, res, done );
        })
    }
    
    // at least one error handler should be bound to the `error` event in order
    // to avoid propagation of errors
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

        // skip
        var skip = req.query[ "$skip" ];
        delete req.query[ "$skip" ];

        // limit
        var limit = req.query[ "$limit" ];
        delete req.query[ "$limit" ];

        // sort
        var sort = req.query[ "$sort" ], dir = 1;
        if ( sort && sort[ 0 ] == "-" ) {
            sort = sort.substr( 1 );
            dir = -1;
        }
        delete req.query[ "$sort" ];

        var cursor = new mw.conn.Cursor().find( req.query );

        if ( skip ) {
            cursor.skip ( skip )
        }

        if ( limit ) {
            cursor.limit( limit );
        }

        if ( sort ) {
            cursor.sort( sort, dir );
        }
        
        cursor
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
    if ( req.params.id ) {
        req.body.id = req.params.id;
    }
    create( mw, req, res );
};

function patch ( mw, req, res ) {
    var found = false;
    var cursor = new mw.conn.Cursor()
        .find({ id: req.params.id })
        .on( "error", on_error( mw, req, res ) )
        .once( "data", function ( obj ) {
            found = true;
            req.body = extend( obj, req.body );
            mw.doBefore( "update", req, res, function () {
                cursor.on( "finish", function () {
                    res.data = req.body;
                    mw.doAfter( "update", req, res, function () {
                        res.end( JSON.stringify( res.data ) );
                    })
                })
                .end( req.body );
            })
        })
        .on( "end", function () {
            if ( !found ) {
                this.emit( 'data', { id: req.params.id });
            }
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

