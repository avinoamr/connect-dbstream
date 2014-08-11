var url = require( "url" );
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

function search ( connection, req, res ) {
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

function read ( connection, req, res ) {
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

function create ( connection, req, res ) {
    var cursor = new connection.Cursor();
    cursor.write( req.body );
    cursor
        .on( "error", on_error( res ) )
        .on( "finish", function() {
            res.send( req.body );
        })
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

function on_error ( res ) {
    return function ( err ) {
        console.error( err );
        res.writeHead( 500, "Internal Server Error" );
        res.end();
    }
}

