// Since AFCH is currently stored in the userspace, this script should be used
// to load AFCH from another place (e.g., the core Gadget file).

///////////////////////////////////////////////
//////// Yet Another AfC Helper Script ////////
//// https://en.wikipedia.org/wiki/WP:AFCH ////
//// https://github.com/WPAFC/afch-rewrite ////
///////////////////////////////////////////////

( function ( mw, importScript ) {
	if ( /^(?:ผู้ใช้:|ฉบับร่าง:|(?:คุยเรื่อง)?วิกิพีเดีย:หน้าชั่วคราว)/.test( mw.config.get( 'wgPageName' ) ) ) {
		// not work! since thwiki is not implemented importScript yet.
		importScript( 'MediaWiki:Gadget-afchelper.js' );
	}
}( mediaWiki, importScript ) );
