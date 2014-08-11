var url = require( "url" );
var connect = require( "connect" );
module.exports = function ( connection ) {
    return function ( req, res, next ) {
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
            res.writeHead( 400, "Bad Request" );
            res.end();
            return
        }

        action( connection, req, res );
    }
}

function search = function ( connection, req, res ) {
    var acc = [];
    new connection.Cursor()
        .find( req.query )
        .on( "error", on_error( res ) )
        .on( "data" , function ( obj ) {
            acc.push( obj ) 
        })
        .on( "end", function() {
            res.end( JSON.stringify( acc ) );
        });
};

function read = function ( connection, req, res ) {
    var found = false;
    new connection.Cursor()
        .find({ id: req.params.id })
        .on( "error", on_error( res ) )
        .once( "data", function ( obj ) {
            found = true;
            res.send( obj );
        })
        .on( "end", function () {
            if ( !found ) {
                res.writeHead( 404, "Not Found" );
            }
            res.end();
        });
};

function create = function ( connection, req, res ) {
    var cursor = new connection.Cursor();
    cursor.write( req.body );
    cursor
        .on( "error", on_error( res ) )
        .on( "finish", function() {
            res.send( data );
        });
        .end();
};

function update ( connection, req, res ) {
    var cursor = new connection.Cursor();
    req.body.id = req.params.id;
    create( connection, req, res );
};

function remove ( conection, req, res ) {
    var cursor = new connection.Cursor();
    cursor.remove({ id: req.params.id });
    cursor
        .on( "error", on_error( res ) )
        .on( "finish", function() {
            res.send({});
        })
        .end();
}

function on_error = function( res ) {
    return function ( err ) {
        console.error( err );
        res.writeHead( 500, "Internal Server Error" );
        res.end();
    }
}

// connect()
//     .use( "/hello", module.exports() )
//     .listen( 8000 );
