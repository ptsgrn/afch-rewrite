// Patch for WPAFC/afch that prevents non-whitelisted
// users from using the *old* helper script.
( function ( $, mw ) {
	mw.loader.using( [ 'mediawiki.api', 'mediawiki.notify' ], function () {
		// TODO: Is this should be used? wait for consensus.
		var whitelistTitle = 'Wikipedia:WikiProject Articles for creation/Participants';

		function showNotListedError( user ) {
			mw.notify(
				$( '<div>' )
					.append( 'AFCH ไม่สามารถโหลดได้เนื่องจาก "' + user + '" ไม่ได้มีชื่ออยู่ใน ' )
					.append(
						$( '<a>' )
							.attr( 'href', mw.util.getUrl( whitelistTitle ) )
							.attr( 'title', whitelistTitle )
							.text( whitelistTitle )
							.attr( 'target', '_blank' )
					)
					.append( ' คุณสามารถส่งคำขอใช้สคริปต์ได้ที่นั่น' ),
				{
					title: 'ข้อผิดพลาด AFCH: ผู้ใช้ไม่ได้รับอนุญาติ',
					autoHide: false
				}
			);
		}

		function destroyOldAfch() {
			// Remove review link
			$( '#ca-afcHelper' ).remove();

			// Old script used displayMessage; just destroy its div.
			// Hopefully no other scripts used it... ^.^
			$( '#display-message' ).remove();

			// Remove all afc-ish divs
			$( 'div[id^="afcHelper_"]' ).remove();

			// Disable the global init functions
			window.afcHelper_init = function () { return false; };
			window.afcHelper_redirect_init = function () { return false; };
			window.afcHelper_ffu_init = function () { return false; };
		}

		function getText( pageTitle ) {
			var deferred = $.Deferred();

			// Use afch-rewrite `AFCH.Page` if possible to utilize cache
			if ( window.AFCH ) {
				return ( new AFCH.Page( pageTitle ) ).getText( true );
			}

			// Otherwise just peform the API request ourselves
			new mw.Api().get( {
				action: 'query',
				prop: 'revisions',
				rvprop: 'content',
				indexpageids: true,
				titles: pageTitle
			} ).done( function ( data ) {
				var id = data.query.pageids[ 0 ];
				deferred.resolve( data.query.pages[ id ].revisions[ 0 ][ '*' ] );
			} );

			return deferred;
		}

		function checkWhitelist() {
			getText( whitelistTitle ).done( function ( text ) {
				var userName = mw.user.id(),
					userAllowed = text.indexOf( userName ) !== -1;

				if ( !userAllowed ) {
					destroyOldAfch();

					// Show the error message. If afch-rewrite is installed,
					// don't show the error message twice.
					if ( !window.AFCH ) {
						showNotListedError( userName );
					}
				}
			} );
		}

		checkWhitelist();
	} );
}( jQuery, mediaWiki ) );
