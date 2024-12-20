// <nowiki>
( function ( AFCH, $, mw ) {
	let $afchLaunchLink, $afch, $afchWrapper,
		afchPage, afchSubmission, afchViews, afchViewer;

	// Die if reviewing a nonexistent page or a userjs/css page
	if ( mw.config.get( 'wgArticleId' ) === 0 ||
		mw.config.get( 'wgPageContentModel' ) !== 'wikitext' ) {
		return;
	}

	/**
	 * Represents an AfC submission -- its status as well as comments.
	 * Call submission.parse() to actually run the parsing process and fill
	 * the object with useful data.
	 *
	 * @param {AFCH.Page} page The submission page
	 */
	AFCH.Submission = function ( page ) {
		// The associated page
		this.page = page;

		// 'WT:Articles for creation/Foo' => 'Foo'
		this.shortTitle = this.page.title.getMainText().match( /([^\/]+)\/?$/ )[ 1 ];

		this.resetVariables();
	};

	/**
	 * Resets variables and lists related to the submission state
	 */
	AFCH.Submission.prototype.resetVariables = function () {
		// Various submission states, set in parse()
		this.isPending = false;
		this.isUnderReview = false;
		this.isDeclined = false;
		this.isDraft = false;

		// Set in updateAttributesAfterParse()
		this.isCurrentlySubmitted = false;
		this.hasAfcTemplate = false;

		// All parameters on the page, zipped up into one
		// pretty package. The most recent value for any given
		// parameter (based on `ts`) takes precedent.
		this.params = {};

		// Holds all of the {{afc submission}} templates that still
		// apply to the page
		this.templates = [];

		// Holds all comments on the page
		this.comments = [];

		// Holds all submitters currently displayed on the page
		// (indicated by the `u` {{afc submission}} parameter)
		this.submitters = [];
	};

	/**
	 * Parses a submission, writing its current status and data to various properties
	 *
	 * @return {jQuery.Deferred} Resolves with the submission when parsed successfully
	 */
	AFCH.Submission.prototype.parse = function () {
		const sub = this,
			deferred = $.Deferred();

		this.page.getTemplates().done( ( templates ) => {
			sub.loadDataFromTemplates( templates );
			sub.sortAndParseInternalData();
			deferred.resolve( sub );
		} );

		return deferred;
	};

	/**
	 * Internal function
	 *
	 * @param {Array} templates list of templates to parse
	 */
	AFCH.Submission.prototype.loadDataFromTemplates = function ( templates ) {
		// Represent each AfC submission template as an object.
		const submissionTemplates = [],
			commentTemplates = [];

		$.each( templates, ( _, template ) => {
			const name = template.target.toLowerCase();
			if ( name === 'afc submission' ) {
				submissionTemplates.push( {
					status: ( AFCH.getAndDelete( template.params, '1' ) || '' ).toLowerCase(),
					timestamp: AFCH.getAndDelete( template.params, 'ts' ) || '',
					params: template.params
				} );
			} else if ( name === 'afc comment' ) {
				commentTemplates.push( {
					// If we can't find a timestamp, set it to unicorns, because everyone
					// knows that unicorns always come first.
					timestamp: AFCH.parseForTimestamp( template.params[ '1' ], /* mwstyle */ true ) || 'unicorns',
					text: template.params[ '1' ]
				} );
			}
		} );

		this.templates = submissionTemplates;
		this.comments = commentTemplates;
	};

	/**
	 * Sort the internal lists of AFC submission and Afc comment templates
	 */
	AFCH.Submission.prototype.sortAndParseInternalData = function () {
		let sub = this,
			submissionTemplates = this.templates,
			commentTemplates = this.comments;

		function timestampSortHelper( a, b ) {
			// If we're passed something that's not a number --
			// for example, {{REVISIONTIMESTAMP}} -- just sort it
			// first and be done with it.
			if ( isNaN( a.timestamp ) ) {
				return -1;
			} else if ( isNaN( b.timestamp ) ) {
				return 1;
			}

			// Otherwise just sort normally
			return +b.timestamp - +a.timestamp;
		}

		// Sort templates by timestamp; most recent are first
		submissionTemplates.sort( timestampSortHelper );
		commentTemplates.sort( timestampSortHelper );

		// Reset variables related to the submisson state before re-parsing
		this.resetVariables();

		// Useful list of "what to do" in each situation.
		const statusCases = {
			// Declined
			d: function () {
				if ( !sub.isPending && !sub.isDraft && !sub.isUnderReview ) {
					sub.isDeclined = true;
				}
				return true;
			},
			// Draft
			t: function () {
				// If it's been submitted or declined, remove draft tag
				if ( sub.isPending || sub.isDeclined || sub.isUnderReview ) {
					return false;
				}
				sub.isDraft = true;
				return true;
			},
			// Under review
			r: function () {
				if ( !sub.isPending && !sub.isDeclined ) {
					sub.isUnderReview = true;
				}
				return true;
			},
			// Pending
			'': function () {
				// Remove duplicate pending templates or a redundant
				// pending template when the submission has already been
				// declined / is already under review
				if ( sub.isPending || sub.isDeclined || sub.isUnderReview ) {
					return false;
				}
				sub.isPending = true;
				sub.isDraft = false;
				sub.isUnderReview = false;
				return true;
			}
		};

		// Process the submission templates in order, from the most recent to
		// the oldest. In the process, we remove unneeded templates (for example,
		// a draft tag when it's already been submitted) and also set various
		// "isX" properties of the Submission.
		submissionTemplates = $.grep( submissionTemplates, ( template ) => {
			let keepTemplate = true;

			if ( statusCases[ template.status ] ) {
				keepTemplate = statusCases[ template.status ]();
			} else {
				// Default pending status
				keepTemplate = statusCases[ '' ]();
			}

			// If we're going to be keeping this template on the page,
			// save the parameter and submitter data. When saving params,
			// don't overwrite parameters that are already set, because
			// we're going newest to oldest (i.e. save most recent only).
			if ( keepTemplate ) {
				// Save parameter data
				sub.params = $.extend( {}, template.params, sub.params );

				// Save submitter if not already listed
				if ( template.params.u && sub.submitters.indexOf( template.params.u ) === -1 ) {
					sub.submitters.push( template.params.u );
				}

				// Will be re-added in makeWikicode() if necessary
				delete template.params.small; // small=yes for old declines
			}

			return keepTemplate;
		} );

		this.isCurrentlySubmitted = this.isPending || this.isUnderReview;
		this.hasAfcTemplate = !!submissionTemplates.length;

		this.templates = submissionTemplates;
		this.comments = commentTemplates;
	};

	/**
	 * Converts all the data to a hunk of wikicode
	 *
	 * @return {string}
	 */
	AFCH.Submission.prototype.makeWikicode = function () {
		let output = [],
			hasDeclineTemplate = false;

		// Submission templates go first
		$.each( this.templates, ( _, template ) => {
			let tout = '{{AfC submission|' + template.status,
				paramKeys = [];

			// FIXME: Think about if we really want this elaborate-ish
			// positional parameter ouput, or if it would be a better
			// idea to just make everything absolute. When we get to a point
			// where nobody is using the actual templates and it's 100%
			// script-based, "pretty" isn't really that important and we
			// can scrap this. Until then, though, we can only dream...

			// Make an array of the parameters
			$.each( template.params, ( key, value ) => {
				// Parameters set to false are ignored
				if ( value !== false ) {
					paramKeys.push( key );
				}
			} );

			paramKeys.sort( ( a, b ) => {
				const aIsNumber = !isNaN( a ),
					bIsNumber = !isNaN( b );

				// If we're passed two numerical parameters then
				// sort them in order (1,2,3)
				if ( aIsNumber && bIsNumber ) {
					return ( +a ) > ( +b ) ? 1 : -1;
				}

				// A is a number, it goes first
				if ( aIsNumber && !bIsNumber ) {
					return -1;
				}

				// B is a number, it goes first
				if ( !aIsNumber && bIsNumber ) {
					return 1;
				}

				// Otherwise just leave the positions as they were
				return 0;
			} );

			$.each( paramKeys, ( index, key ) => {
				const value = template.params[ key ];
				// If it is a numerical parameter, doesn't include
				// `=` in the value, AND is in sequence with the other
				// numerical parameters, we can omit the key= part
				// (positional parameters, joyous day :/ )
				if ( key == +key && +key % 1 === 0 &&
					value.indexOf( '=' ) === -1 &&
					// Parameter 2 will be the first positional parameter,
					// since 1 is always going to be the submission status.
					( key === '2' || paramKeys[ index - 1 ] == +key - 1 ) ) {
					tout += '|' + value;
				} else {
					tout += '|' + key + '=' + value;
				}
			} );

			// Collapse old decline template if a newer decline
			// template is already displayed on the page
			if ( hasDeclineTemplate && template.status === 'd' ) {
				tout += '|small=yes';
			}

			// So that subsequent decline templates will be collapsed
			if ( template.status === 'd' ) {
				hasDeclineTemplate = true;
			}

			// Finally, add the timestamp and a warning about removing the template
			tout += '|ts=' + template.timestamp + '}} <!-- กรุณาอย่าลบบรรทัดนี้! -->';

			output.push( tout );
		} );

		// Then comment templates
		$.each( this.comments, ( _, comment ) => {
			output.push( '\n{{AfC comment|1=' + comment.text + '}}' );
		} );

		// If there were comments, add a horizontal rule beneath them
		if ( this.comments.length ) {
			output.push( '\n----' );
		}
		return output.join( '\n' );
	};

	/**
	 * Checks if submission is G13 eligible
	 *
	 * @return {jQuery.Deferred} Resolves to bool if submission is eligible
	 */
	AFCH.Submission.prototype.isG13Eligible = function () {
		const deferred = $.Deferred();

		// Submission must not currently be submitted
		if ( this.isCurrentlySubmitted ) {
			return deferred.resolve( false );
		}

		// Userspace drafts must have
		// one or more AFC submission templates to be eligible
		if ( this.page.title.getNamespaceId() == 2 &&
			this.templates.length === 0 ) {
			return deferred.resolve( false );
		}

		// And not have been modified in 6 months
		// FIXME: Ignore bot edits?
		this.page.getLastModifiedDate().done( ( lastEdited ) => {
			const timeNow = new Date(),
				sixMonthsAgo = new Date();

			sixMonthsAgo.setMonth( timeNow.getMonth() - 6 );

			deferred.resolve( ( timeNow.getTime() - lastEdited.getTime() ) >
				( timeNow.getTime() - sixMonthsAgo.getTime() ) );
		} );

		return deferred;
	};

	/**
	 * Sets the submission status
	 *
	 * @param {string} newStatus status to set, 'd'|'t'|'r'|''
	 * @param {Object} newParams optional; params to add to the template whose status was set
	 * @return {boolean} success
	 */
	AFCH.Submission.prototype.setStatus = function ( newStatus, newParams ) {
		const relevantTemplate = this.templates[ 0 ];

		if ( [ 'd', 't', 'r', '' ].indexOf( newStatus ) === -1 ) {
			// Unrecognized status
			return false;
		}

		if ( !newParams ) {
			newParams = {};
		}

		// If there are no templates on the page, just generate a new one
		// (addNewTemplate handles the reparsing)
		if ( !relevantTemplate ||
			// Same for if the top template on the stack is already declined;
			// we don't want to overwrite it
			relevantTemplate.status === 'd' ) {
			this.addNewTemplate( {
				status: newStatus,
				params: newParams
			} );
		} else {
			// Just modify the template at the top of the stack
			relevantTemplate.status = newStatus;
			relevantTemplate.params.ns = mw.config.get( 'wgNamespaceNumber' );

			// Add new parameters if specified
			$.extend( relevantTemplate.params, newParams );

			// And finally reparse
			this.sortAndParseInternalData();
		}

		return true;
	};

	/**
	 * Add a new template to the beginning of this.templates
	 *
	 * @param {Object} data object with properties of template
	 *                      - status (default: '')
	 *                      - timestamp (default: '{{subst:REVISIONTIMESTAMP}}')
	 *                      - params (default: {})
	 */
	AFCH.Submission.prototype.addNewTemplate = function ( data ) {
		this.templates.unshift( $.extend( /* deep */ true, {
			status: '',
			timestamp: '{{subst:REVISIONTIMESTAMP}}',
			params: {
				ns: mw.config.get( 'wgNamespaceNumber' )
			}
		}, data ) );

		// Reparse :P
		this.sortAndParseInternalData();
	};

	/**
	 * Add a new comment to the beginning of this.comments
	 *
	 * @param {string} text comment text
	 * @return {boolean} success
	 */
	AFCH.Submission.prototype.addNewComment = function ( text ) {
		const commentText = addSignature( text );

		this.comments.unshift( {
			// Unicorns are explained in loadDataFromTemplates()
			timestamp: AFCH.parseForTimestamp( commentText, /* mwstyle */ true ) || 'unicorns',
			text: commentText
		} );

		// Reparse :P
		this.sortAndParseInternalData();

		return true;
	};

	/**
	 * Gets the submitter, or, if no specific submitter is available,
	 * just the page creator
	 *
	 * @return {jQuery.Deferred} resolves with user
	 */
	AFCH.Submission.prototype.getSubmitter = function () {
		const deferred = $.Deferred(),
			user = this.params.u;

		// Recursively detect if the user has been renamed by checking the rename log
		if ( user ) {
			AFCH.api.get( {
				action: 'query',
				list: 'logevents',
				formatversion: 2,
				letype: 'renameuser',
				lelimit: 1,
				letitle: 'User:' + user
			} ).then( ( resp ) => {
				const logevents = resp.query.logevents;

				if ( logevents.length ) {
					const newName = logevents[ 0 ].params.newuser;
					this.params.u = newName;
					this.getSubmitter().then( ( user ) => {
						deferred.resolve( user );
					} );
				} else {
					deferred.resolve( user );
				}
			} );
		} else {
			this.page.getCreator().done( ( user ) => {
				deferred.resolve( user );
			} );
		}

		return deferred;
	};

	/**
	 * Represents text of an AfC submission
	 *
	 * @param {string} text
	 */
	AFCH.Text = function ( text ) {
		this.text = text;
	};

	AFCH.Text.prototype.get = function () {
		return this.text;
	};

	AFCH.Text.prototype.set = function ( string ) {
		this.text = string;
		return this.text;
	};

	AFCH.Text.prototype.prepend = function ( string ) {
		this.text = string + this.text;
		return this.text;
	};

	AFCH.Text.prototype.append = function ( string ) {
		this.text += string;
		return this.text;
	};

	AFCH.Text.prototype.cleanUp = function ( isAccept ) {
		let text = this.text,
			commentRegex,
			commentsToRemove = [
				'Please don\'t change anything and press save',
				'Carry on from here, and delete this comment.',
				'Please leave this line alone!',
				'Important, do not remove this line before (template|article) has been created.',
				'Just press the "Save page" button below without changing anything! Doing so will submit your article submission for review. ' +
				'Once you have saved this page you will find a new yellow \'Review waiting\' box at the bottom of your submission page. ' +
				'If you have submitted your page previously,(?: either)? the old pink \'Submission declined\' template or the old grey ' +
				'\'Draft\' template will still appear at the top of your submission page, but you should ignore (them|it). Again, please ' +
				'don\'t change anything in this text box. Just press the "Save page" button below.'
			];

		if ( isAccept ) {
			// Remove {{Draft categories}}
			text = text.replace( /\{\{(?:Draft categories|หมวดหมู่ฉบับร่าง)\s*\|((?:\s*\[\[:?(หมวดหมู่|Category):[ \S]+?\]\]\s*)*)\s*\}\}/gi, '$1' );

			// Remove {{Draft article}} (and {{Draft}}).
			// Not removed if the |text= parameter is present, which could contain
			// arbitrary wikitext and therefore makes the end of the template harder
			// to detect
			text = text.replace( /\{\{Draft(?!\|\s*text\s*=)(?: article(?!\|\s*text\s*=)(?:\|(?:subject=)?[^|]+)?|\|(?:subject=)?[^|]+)?\}\}/gi, '' );
			text = text.replace( /\{\{ฉบับร่าง(?!\|\s*text\s*=)(?:บทความ(?!\|\s*text\s*=)(?:\|(?:subject=)?[^\|]+)?|\|(?:subject=)?[^\|]+)?\}\}/gi, '' );
			text = text.replace( /\{\{บทความ(?:ฉบับร่าง(?!\|\s*text\s*=)(?:\|(?:subject=)?[^\|]+)?|\|(?:subject=)?[^\|]+)?\}\}/gi, '' );

			// Uncomment cats and templates
			text = text.replace( /\[\[:(Category|หมวดหมู่):/gi, '[[หมวดหมู่:' );
			text = text.replace( /\{\{(tl|tlx|tlg)\|(.*?)\}\}/ig, '{{$2}}' );

			const templatesToRemove = [
				'AfC postpone G13',
				'Draft topics',
				'AfC topic',
				'Drafts moved from mainspace',
				'Promising draft',
				'บทความฉบับร่าง',
				'ฉบับร่างบทความ'
			];

			templatesToRemove.forEach( ( template ) => {
				text = text.replace( new RegExp( '\\{\\{' + template + '\\s*\\|?(.*?)\\}\\}\\n?', 'gi' ), '' );
			} );

			// Add to the list of comments to remove
			$.merge( commentsToRemove, [
				'Enter template purpose and instructions here.',
				'Enter the content and\\/or code of the template here.',
				'EDIT BELOW THIS LINE',
				'Metadata: see \\[\\[Wikipedia:Persondata\\]\\].',
				'See http://en.wikipedia.org/wiki/Wikipedia:Footnotes on how to create references using\\<ref\\>\\<\\/ref\\> tags, these references will then appear here automatically',
				'(After listing your sources please cite them using inline citations and place them after the information they cite.|Inline citations added to your article will automatically display here.) ' +
				'(Please see|See) ((https?://)?en.wikipedia.org/wiki/(Wikipedia|WP):REFB|\\[\\[Wikipedia:REFB\\]\\]) for instructions on how to add citations.'
			] );

			// thank to iScript cleanup module
			text = convertExternalLinksToWikilinks( text );
			text = toomuchVowels( text );
			text = reFormat( text );
			text = policyFix( text );
			text = fixSpelling( text );
		} else {
			// If not yet accepted, comment out cats

			text = text.replace( /\[\[(Category|หมวดหมู่):/gi, '[[:หมวดหมู่:' );
		}

		// Remove empty section at the end (caused by "Resubmit" button on "declined" template)
		// Section may have categories after it - keep them there
		text = AFCH.removeEmptySectionAtEnd( text );
		text = text.replace( /\n+==.+?==((?:\[\[:?(Category|หมวดหมู่):.+?\]\]|\s+)*)$/, '$1' );

		// Assemble a master regexp and remove all now-unneeded comments (commentsToRemove)
		commentRegex = new RegExp( '<!-{2,}\\s*(' + commentsToRemove.join( '|' ) + ')\\s*-{2,}>', 'gi' );
		text = text.replace( commentRegex, '' );

		// Remove initial request artifact
		text = text.replace( /== Request review at \[\[WP:AFC\]\] ==/gi, '' );

		// Remove sandbox templates
		text = text.replace( /\{\{(userspacedraft|userspace draft|user sandbox|Please leave this line alone \(sandbox heading\))(?:\{\{[^{}]*\}\}|[^}{])*\}\}/ig, '' );
		text = text.replace( /\{\{(กระบะทรายผู้ใช้|กรุณาอย่าแก้ไขบรรทัดนี้ \(ส่วนหัวหน้าทดลองเขียน\))(?:\{\{[^{}]*\}\}|[^}{])*\}\}/ig, '' );

		// Remove html comments (<!--) that surround categories
		text = text.replace( /<!--\s*((\[\[:{0,1}((Category|หมวดหมู่):.*?)\]\]\s*)+)-->/gi, '$1' );

		// Remove spaces/commas between <ref> tags
		text = text.replace( /\s*(<\/\s*ref\s*>)\s*[,]*\s*(<\s*ref\s*(name\s*=|group\s*=)*\s*[^/]*>)[ \t]*$/gim, '$1$2' );

		// Remove whitespace before <ref> tags
		text = text.replace( /[ \t]*(<\s*ref\s*(name\s*=|group\s*=)*\s*.*[^/]+>)[ \t]*$/gim, '$1' );

		// Move punctuation before <ref> tags
		text = text.replace( /\s*((<\s*ref\s*(name\s*=|group\s*=)*\s*.*[/]{1}>)|(<\s*ref\s*(name\s*=|group\s*=)*\s*[^/]*>(?:<[^<>]*>|[^><])*<\/\s*ref\s*>))[ \t]*([.!?,;:])+$/gim, '$6$1' );

		// Replace {{http://example.com/foo}} with "* http://example.com/foo" (common newbie error)
		text = text.replace( /\n\{\{(http[s]?|ftp[s]?|irc|gopher|telnet):\/\/(.*?)\}\}/gi, '\n* $1://$3' );

		// Convert http://-style links to other wikipages to wikicode syntax
		// FIXME: Break this out into its own core function? Will it be used elsewhere?
		function convertExternalLinksToWikilinks( text ) {
			let linkRegex = /\[{1,2}(?:https?:)?\/\/(?:en.wikipedia.org\/wiki|enwp.org)\/([^\s|\][]+)(?:\s|\|)?((?:\[\[[^[\]]*\]\]|[^\][])*)\]{1,2}/ig,
				linkMatch = linkRegex.exec( text ),
				title, displayTitle, newLink;

			while ( linkMatch ) {
				title = decodeURI( linkMatch[ 1 ] ).replace( /_/g, ' ' );
				displayTitle = decodeURI( linkMatch[ 2 ] ).replace( /_/g, ' ' );

				// Don't include the displayTitle if it is equal to the title
				if ( displayTitle && title !== displayTitle ) {
					newLink = '[[' + title + '|' + displayTitle + ']]';
				} else {
					newLink = '[[' + title + ']]';
				}

				text = text.replace( linkMatch[ 0 ], newLink );
				linkMatch = linkRegex.exec( text );
			}

			return text;
		}

		/**
		 * Fix the spelling.
		 * Taken from iScript modules.
		 *
		 * @author iScript authors
		 * @param {string} text text to fix
		 * @return fixed text
		 */
		function fixSpelling( text ) {
			// Spellings
			if ( text.indexOf( 'nofixbot' ) !== -1 ) { // do not run if nofixbot
				text = text
					.replace( /ไบท์(?!\]\])/g, 'ไบต์' ) // Ordering is intended
					.replace( /เยอรมันนี/g, 'เยอรมนี' )
					.replace( /\sกฏ/g, ' กฎ' )
					.replace( /\sเกมส์/g, ' เกม' )
					.replace( /ก๊กกะ|กิกะ(?=ไบต์|บิ)/g, 'จิกะ' )
					.replace( /กฏหมาย/g, 'กฎหมาย' )
					.replace( /กรกฏาคม/g, 'กรกฎาคม' )
					.replace( /กระทั้ง/g, 'กระทั่ง' )
					.replace( /กราฟฟิค|กราฟฟิก/g, 'กราฟิก' )
					.replace( /กษัตรย์/g, 'กษัตริย์' )
					.replace( /กิติมศักดิ์/g, 'กิตติมศักดิ์' )
					.replace( /ขาดดุลย์/g, 'ขาดดุล' )
					.replace( /คริสต(ศตวรรษ|ศักราช|ศาสนา)/g, 'คริสต์$1' )
					.replace( /คริสต์กาล/g, 'คริสตกาล' )
					.replace( /คริสต์เตียน/g, 'คริสเตียน' )
					.replace( /คริสมาส|คริสมาสต์/g, 'คริสต์มาส' )
					.replace( /คลีนิก/g, 'คลินิก' )
					.replace( /คำนวน/g, 'คำนวณ' )
					.replace( /เคเบิ้ล/g, 'เคเบิล' )
					.replace( /โครงการณ์/g, 'โครงการ' )
					.replace( /งบดุลย์/g, 'งบดุล' )
					.replace( /จักรสาน/g, 'จักสาน' )
					.replace( /ซอฟท์แวร์/g, 'ซอฟต์แวร์' )
					.replace( /ซีรี่ส์|ซีรีย์|ซีรี่ย์/g, 'ซีรีส์' )
					.replace( /เซ็นติ/g, 'เซนติ' )
					.replace( /เซอร์เวอร์/g, 'เซิร์ฟเวอร์' )
					.replace( /ฑูต/g, 'ทูต' )
					.replace( /ดอท ?คอม|ด็อท ?คอม|ด็อต ?คอม/g, 'ดอตคอม' )
					.replace( /ดอท ?เน็ท|ดอต ?เน็ท|ด็อต ?เน็ต|ด็อท ?เน็ต|ดอท ?เน็ต|ดอท?เนท/g, 'ดอตเน็ต' )
					.replace( /ถ่วงดุลย์/g, 'ถ่วงดุล' )
					.replace( /ทรงทอดพระเนตร/g, 'ทอดพระเนตร' )
					.replace( /ทรงบรรทม/g, 'บรรทม' )
					.replace( /ทรงประชวร/g, 'ประชวร' )
					.replace( /ทรงเป็นพระ/g, 'เป็นพระ' )
					.replace( /ทรงผนวช/g, 'ผนวช' )
					.replace( /ทรงมีพระ/g, 'มีพระ' )
					.replace( /ทรงสวรรคต/g, 'สวรรค' )
					.replace( /ทรงเสด็จ/g, 'เสด็จ' )
					.replace( /(?!วัด)ทรงเสวย/g, 'เสวย' )
					.replace( /ทะเลสาป(?!สีเลือด)/g, 'ทะเลสาบ' )
					.replace( /เทมเพลท/g, 'เทมเพลต' )
					.replace( /ธุระกิจ/g, 'ธุรกิจ' )
					.replace( /นิวยอร์ค/g, 'นิวยอร์ก' )
					.replace( /โน๊ต/g, 'โน้ต' )
					.replace( /บรรได/g, 'บันได' )
					.replace( /บรรเทิง(?!จิตร)/g, 'บันเทิง' ) // See: ประสิทธิ์ ศิริบรรเทิง and กรรณิการ์ บรรเทิงจิตร
					.replace( /บราวเซอร์|เบราเซอร์/g, 'เบราว์เซอร์' )
					.replace( /บล็อค|บล๊อค|บล๊อก/g, 'บล็อก' )
					.replace( /เบรค/g, 'เบรก' )
					.replace( /ปฎิ/g, 'ปฏิ' )
					.replace( /ปฏิกริยา|ปฎิกริยา/g, 'ปฏิกิริยา' )
					.replace( /ปรากฎ/g, 'ปรากฏ' )
					.replace( /ปราถนา/g, 'ปรารถนา' )
					.replace( /ปีรามิด|ปิระมิด/g, 'พีระมิด' )
					.replace( /โปรเจ็?คท์|โปรเจ็?คต์|โปรเจ็?ค/g, 'โปรเจกต์' )
					.replace( /โปรโตคอล/g, 'โพรโทคอล' )
					.replace( /ผลลัพท์/g, 'ผลลัพธ์' )
					.replace( /ผูกพันธ์/g, 'ผูกพัน' )
					.replace( /ฝรั่งเศษ/g, 'ฝรั่งเศส' )
					.replace( /ฟังก์ชั่น/g, 'ฟังก์ชัน' )
					.replace( /ภาพยนต์/g, 'ภาพยนตร์' )
					.replace( /มิวสิค(?!\u0E31)/g, 'มิวสิก' )
					.replace( /ไมโครซอฟต์/g, 'ไมโครซอฟท์' )
					.replace( /รถยนตร์/g, 'รถยนต์' )
					.replace( /ร็อค(?!แม)/g, 'ร็อก' ) // ignore ร็อคแมน
					.replace( /ฤา/g, 'ฤๅ' )
					.replace( /ล็อค/g, 'ล็อก' )
					.replace( /ลอส แองเจลิส|ลอส แองเจลลิส|ลอส แองเจลีส|ลอสแองเจลิส|ลอสแองเจลีส|ลอสแองเจลลิส|ลอสแองเจอลิส|ลอสแองเจอลีส|ลอสแอนเจลลิส/g, 'ลอสแอนเจลิส' )
					.replace( /ลายเซ็นต์/g, 'ลายเซ็น' )
					.replace( /ลิงค์|ลิ้งค์|ลิ๊งค์|ลิ้งก์|ลิ๊งก์/g, 'ลิงก์' )
					.replace( /เวคเตอร์/g, 'เวกเตอร์' )
					.replace( /เวทย์มนตร์|เวทย์มนต์|เวทมนต์/g, 'เวทมนตร์' )
					.replace( /เวบไซท์|เวบไซต์|เวบไซท์|เว็บไซท์|เว็บไซต(?!\u0E4C)/g, 'เว็บไซต์' )
					.replace( /เวอร์ชั่น/g, 'เวอร์ชัน' )
					.replace( /เวิล์ด/g, 'เวิลด์' )
					.replace( /ศรีษะ/g, 'ศีรษะ' )
					.replace( /สคริปท์|สครปต์/g, 'สคริปต์' )
					.replace( /สเตชั่น/g, 'สเตชัน' )
					.replace( /สมดุลย์/g, 'สมดุล' )
					.replace( /สวดมน(?!\u0E21|\u0E15)|สวดมนตร์/g, 'สวดมนต์' )
					.replace( /สวรรณคต/g, 'สวรรคต' )
					.replace( /สังเกตุ/g, 'สังเกต' )
					.replace( /อโดบี/g, 'อะโดบี' )
					.replace( /อนิเม(?!\u0E30|ช|ท|ต)|อานิเมะ|อะนิเมะ/g, 'อนิเมะ' )
					// .replace(/อนิเม(?!ช|ท|ต)|อานิเมะ|อะนิเม(?!\u0E30|\u0E47|ช|ท|ต|เ|แ)/g, "อะนิเมะ")
					.replace( /อนุญาติ/g, 'อนุญาต' )
					.replace( /อลูมิเนียม/g, 'อะลูมิเนียม' )
					.replace( /ออบเจ็ค|ออปเจ็ค|ออปเจค/g, 'อ็อบเจกต์' )
					.replace( /อัพเด็ต|อัพเดต|อัพเดท|อัปเด็ต/g, 'อัปเดต' )
					.replace( /อัพโหลด/g, 'อัปโหลด' )
					.replace( /อินเตอเน็ต|อินเตอร์เน็ต|อินเตอร์เนต|อินเทอร์เนต/g, 'อินเทอร์เน็ต' )
					.replace( /อิเล็กโทรนิกส์/g, 'อิเล็กทรอนิกส์' )
					.replace( /อิสระภาพ/g, 'อิสรภาพ' )
					.replace( /เอ็กซ์/g, 'เอกซ์' )
					.replace( /เอ็นจิ้น|เอ็นจิน|เอนจิ้น/g, 'เอนจิน' )
					.replace( /เอล์ฟ/, 'เอลฟ์' )
					.replace( /เอาท์พุต|เอาท์พุท/g, 'เอาต์พุต' )
					.replace( /แอปพลิเคชั่น|แอพพลิเคชั่น|แอพพลิเคชัน|แอพพลิคเคชัน/g, 'แอปพลิเคชัน' )

					// Exceptions cases handling
					.replace( /คริสต์มาส วิไลโรจน์/g, 'คริสมาส วิไลโรจน์' )
					.replace( /สมาคมเนชั่นแนล จีโอกราฟิก/g, 'สมาคมเนชั่นแนล จีโอกราฟฟิก' )
					.replace( /(อีเอ็มไอ|เบเกอรี่)มิวสิก/g, '$1มิวสิค' )
					.replace( /สตรีลิงก์/g, 'สตรีลิงค์' )
					.replace( /นกหัสดีลิงก์/g, 'นกหัสดีลิงค์' )
					.replace( /โปรเจกต์วัน/g, 'โปรเจควัน' )
					.replace( /ร โปรเจกต์/g, 'ร โปรเจ็คต์' ) // ดิ โอฬาร โปรเจ็คต์
					.replace( /สารอัปเดต/g, 'สารอัพเดท' ); // นิตรสารอัพเดท

				// .replace(/เอ็กซเรย์/g, "เอกซเรย์")
			}
			return text;
		}

		/**
		 * Fixing some common mistakes in the text
		 * Taken from iScript modules.
		 *
		 * @author iScript authors
		 * @param {string} text text to fix
		 * @return fixed text
		 */
		function policyFix( text ) {
			text = text
			/* policyFix */
				.replace( /(>|\n|\[|^)(image|file):/ig, '$1ไฟล์:' )
				.replace( /(>|\n|\[|^)ภาพ:/ig, '$1ไฟล์:' )
				.replace( /== *(แหล่งอ้างอิง|หนังสืออ้างอิง|เอกสารอ้างอิง|ข้อมูลอ้างอิง|แหล่งข้อมูลอ้างอิง|อ้างอิงจาก) *==/ig, '== อ้างอิง ==' )
				.replace( /== *(เพิ่มเติม|ดูเพิ่มเติม|ดูเพื่มเติม|ดูเพิ่มที่|อ่านเพิ่ม|อ่านเพิ่มเติม|หัวข้อที่เกี่ยวข้อง|หัวข้ออื่นที่เกี่ยวข้อง|ลิงก์ที่เกี่ยวข้อง) *==/ig, '== ดูเพิ่ม ==' )
				.replace( /== *(เว็บไซต์|เว็บไซต์ภายนอก|เว็บไซต์อื่น|เว็บไซต์ที่เกี่ยวข้อง|ข้อมูลภายนอก|โยงภายนอก|เว็บลิงก์ภายนอก|ลิงก์ภายนอก|ลิงค์ภายนอก|ลิ้งค์ภายนอก|ดูลิงก์ภายนอก|แหล่งข้อมูลภายนอก|แหล่งข้อมูลเพิ่มเติม|แหล่งข้อมูลที่เกี่ยวข้อง|แหล่งข้อข้อมูลอื่น) *==/ig, '== แหล่งข้อมูลอื่น ==' )
				.replace( /== *(Link\s?ภายนอก|link\s?ภายนอก|ลิงก์ข้างนอก|ลิงก์ที่เกี่ยวข้อง|ลิงก์ข้อมูลเพิ่มเติม|เว็บแหล่งข้อมูลอื่น|เชื่อมแหล่งข้อมูลอื่น|เชื่อมโยงลิงก์อื่น|ลิงก์นอก) *==/ig, '== แหล่งข้อมูลอื่น ==' )
				.replace( /== *(ประวัติความเป็นมา|ประวัติส่วนตัว|ความเป็นมา|ชีวประวัติ) *==/ig, '$1ประวัติ ==' )
				.replace( /\[\[category:/ig, '[[หมวดหมู่:' )
				.replace( /\[\[template:/ig, '[[แม่แบบ:' )
				.replace( /\n{0,}{{โครง(?!-?ส่วน|การพี่น้อง)(.*?)}} ?((?:\n*?\[\[หมวดหมู่:.*?\]\])*)/g, '$2\n\n{{โครง$1}}' ); // Move stub below categories // was only detecting in NS:0

			return text;
		}

		/**
		 * Fix some unnecessary exeed vowels in Thai in text
		 * Taken from iScript modules.
		 *
		 * @author iScript authors
		 * @param {string} text text to fix
		 * @return fixed text
		 */
		function toomuchVowels( text ) {
			// Fix double Thai vowels
			// # สระหน้า           เ|แ|โ|ใ|ไ
			// # สระหลัง           ะ|า|ๅ
			// # อำ คือ             ำ
			// # สระบน             ั|ิ|ี|ึ|ื|ํ
			// # สระล่าง            ุ|ู|ฺ
			// # ไม้ไต่คู้             ็
			// # วรรณยุกต์          ่|้|๊|๋
			// # ทัณฑฆาต          ์
			// # ไปยาลน้อย        ฯ
			// # ไม้ยมก           ๆ
			// text = text.replace(/(แ|โ|ใ|ไ|ะ|า|ๅ|ำ|ั|ิ|ี|ึ|ื|ํ|ุ|ู|ฺ|็|่|้|๊|๋|์){2,}/g, "$1") //remove dup

			text = text
				.replace( /ํา/g, 'ำ' ) // Nikhahit (nikkhahit) + Sara Aa -> Saram Am
				.replace( /เเ/g, 'แ' ) // Sara E + Sara E -> Sara Ae
				.replace( /(เ|แ|โ|ใ|ไ)(ะ|า|ๅ|ำ|ั|ิ|ี|ึ|ื|ํ|ุ|ู|ฺ|็|่|้|๊|๋|์)/g, '$1' ) // สระหน้า
				.replace( /(ะ|า|ๅ)(ำ|ั|ิ|ี|ึ|ื|ํ|ุ|ู|ฺ|็|่|้|๊|๋|์)/g, '$1' ) // สระหลัง
				.replace( /(ำ)(ำ|ั|ิ|ี|ึ|ื|ํ|ุ|ู|ฺ|็|่|้|๊|๋|์)/g, '$1' ) // สระอำ
				.replace( /(ั|ิ|ี|ึ|ื|ํ)( ะ|า|ๅ|ำ|ั|ิ|ี|ึ|ื|ํ|ุ|ู|ฺ|็)/g, '$1' ) // สระบน
				.replace( /(ุ|ู|ฺ)( ะ|า|ๅ|ำ|ั|ิ|ี|ึ|ื|ํ|ุ|ู|ฺ|็)/g, '$1' ) // สระล่าง
				.replace( /(็)( ะ|า|ๅ|ำ|ั|ิ|ี|ึ|ื|ํ|ุ|ู|ฺ|็)/g, '$1' ) // ไม้ไต่คู้
				.replace( /(่|้|๊|๋)(ั|ิ|ี|ึ|ื|ํ|ุ|ู|ฺ|็|่|้|๊|๋|์)/g, '$1' ) // วรรณยุกต์

				.replace( /\u0E48\u0E48/g, '\u0E48' ) // Mai Ek
				.replace( /\u0E49\u0E49/g, '\u0E49' ) // Mai Tho
				.replace( /\u0E4A\u0E4A/g, '\u0E4A' ) // Mai Tri
				.replace( /\u0E4B\u0E4B/g, '\u0E4B' ) // Mai Chattawa
				.replace( /์์/g, '์' ); // ทัณฑฆาต

			return text;
		}

		/**
		 * Reformatting various text style
		 * Taken from iScript modules.
		 *
		 * @author iScript authors
		 * @param {string} text text to fix
		 * @return fixed text
		 */
		function reFormat( text ) {
			/* reformat - header */
			text = text
				.replace( /\n(={1,5}) ?''' ?(.*) ?''' ?(={1,5})/gm, '\n$1 $2 $3' ) // == '''หัวข้อ''' == -> == หัวข้อ ==
				.replace( /^= ?([^=].*?) ?=/gm, '== $1 ==' ) // = หัวข้อ =  -> == หัวข้อ ==
				.replace( /^(={1,5}) *(.*?) ?(={1,5}) *$/gm, '$1 $2 $3' ); // ==หัวข้อ== -> == หัวข้อ ==

			/* reformat - parentheses */
			// Add exception for RTL languages. Example:ps:ماينامار(برما)
			var rtlLangPrefix = [ 'ar', 'arc', 'ckb', 'dv', 'fa', 'ha', 'he', 'khw', 'ks', 'ps', 'sd', 'ur', 'yi' ]; // https://meta.wikimedia.org/wiki/Template:List_of_language_names_ordered_by_code
			var matches = text.match( new RegExp( '\\[\\[(?:' + rtlLangPrefix.join( '|' ) + ')\\:.*?\\]\\]', 'ig' ) );
			text = text
				.replace( /(.(?!( f\()).[^\s\[\]\(\_\#\/\{\"\f])\(/g, '$1$2 (' ) // Ignore f(x) case from f (x)
				.replace( /(.*?)\)([^\s\]\)\|\.\_\#\/\}\"\,\<\"])/g, '$1) $2' )
				.replace( /(.*?)\]\]\(/g, '$1]] (' ); // Allow spacing for link scenario such as [[Link]](Hello World!)

			if ( matches ) {
				for ( var i in matches ) {
					// duplicate of above
					var rtlEdgeCase = matches[ i ]
						.replace( /(.(?!( f\()).[^\s\[\]\(\_\#\/\{\"\f])\(/g, '$1$2 (' ) // Ignore f(x) case from f (x)
						.replace( /(.*?)\)([^\s\]\)\|\.\_\#\/\}\"\,\<\"])/g, '$1) $2' )
						.replace( /(.*?)\]\]\(/g, '$1]] (' ); // Allow spacing for link scenario such as [[Link]](Hello World!)

					// now fix the error
					text = text.replace( rtlEdgeCase, matches[ i ] );
				}
			}

			/* reformat - others */
			text = text
				.replace( new RegExp( '\\[\\[(' + mw.config.get( 'wgPageName' ).replace( /_/g, ' ' ) + ')\\]\\]', 'g' ), '\'\'\'$1\'\'\'' ) // Basic replace [[wgPageName]] to '''wgPageName'''
				.replace( /\[\[หมวดหมู่: {1,}(.*?)\]\]/g, '[[หมวดหมู่:$1]]' ) // [[หมวดหมู่: xxx]] -> [[หมวดหมู่:xxx]] (เว้นกี่ช่องก็ได้)
				.replace( /{{แม่แบบ:(.*?)}}/g, '{{$1}}' ) // {{แม่แบบ:xxx}} -> {{xxx}}
				.replace( /(พ|ค)\.? ?ศ. ?(\d{1,4})/g, '$1.ศ. $2' ) // Fix Year Formatting
				.replace( /^([\*#]+) {0,}/gm, '$1 ' ) // *xxx -> * xxx (ul) and #xxx -> # xxx (ol)
				.replace( /<\/(.*?) {1,}>/g, '</$1>' ) // Fix tag spacing, </xxx > -> </xxx>
				.replace( /<ref(.*?)> ?({{.*? icon}}) ?(.*?) ?<\/ref>/g, '<ref$1>$3 $2</ref>' ); // Fix lang icons: Move from front to back // แก้ <ref...> {{...}} [...] </ref> -> <ref...>[...] {{...}}</ref> // Case Study: //th.wikipedia.org/w/index.php?title=เหตุการณ์แผ่นดินไหวในมณฑลเสฉวน_พ.ศ._2551&diff=1161797&oldid=1152067

			// Remove signatures on article pages if not uncyclopedia
			text = text.replace( /-{0,2} ?\[\[ผู้ใช้:.*/g, '' );

			// Fix Template Parameters Layout: Move | from back to front (using Top to Bottom approach)
			text = text.replace( / *\|(?!-) *\r?\n *([^=\*<|{}]*?) ?=(?!=) *([^\|={}]*?)/gm, '\n| $1 = $2' ); // รวมแก้สองอย่างโดยการตรวจย้ายบนไปล่างแทน
			// text = text.replace(/({{.*)(?!})\| *\r/g,"$1");                                   //แก้ {{... | -> {{...
			// text = text.replace(/(\n) *([^|{}]*?) ?= *([^|{}]*?)\| *\r/g,"$1| $2 = $3");      //แก้ ... | -> | ...

			// TODO: Need comments for code below for maintenance reasons: Hard to debug
			text = text.replace( /\n *\|(?!-) *([^={}\*].*?) ?= *([^<={}]*?) \| ?( *}} *\r?\n| *\r?\n *}} *\r?\n)/g, '\n| $1 = $2\n}}\n' ); // รุ่นใหม่ แค่จับขึ้นบรรทัดใหม่
			// text = text.replace(/(\n) *([^\|{}].*?) ?= *([^|{}]*?)(}}\r\n|\r\n *}})/g,"$1| $2 = $3\n}}");//แก้ ... -> | ...

			// Fix Template Parameters Layout: Add extra space in betweens
			text = text.replace( /\r?\n *\|(?!-) *([^=\|\?'"{}]*?) ?= *([^=]*?) */g, '\n| $1 = $2' );

			// Fix Template: Remove extra | if exist at the end
			text = text.replace( /\n *\|(?!-) *([^=\|'"{}]*?)=([^=\|]*?) ?\r?\n?\| ?\r?\n?\}\}(?!\})/g, '\n| $1 = $2\n}}' ); // | abc = 123 | }} -> | abc = 123 }}

			return text;
		}

		this.text = text;
		this.removeExcessNewlines();

		return this.text;
	};

	AFCH.Text.prototype.removeExcessNewlines = function () {
		// Replace 3+ newlines with just two
		this.text = this.text.replace( /(?:[\t ]*(?:\r?\n|\r)){3,}/ig, '\n\n' );
		// Remove all whitespace at the top of the article
		this.text = this.text.replace( /^\s*/, '' );
	};

	AFCH.Text.prototype.getAfcComments = function () {
		return this.text.match( /\{\{\s*afc comment[\s\S]+?\(UTC\)\}\}/gi );
	};

	AFCH.Text.prototype.removeAfcTemplates = function () {
		// FIXME: Awful regex to remove the old submission templates
		// This is bad. It works for most cases but has a hellish time
		// with some double nested templates or faux nested templates (for
		// example "{{hi|{ foo}}" -- note the extra bracket). Ideally Parsoid
		// would just return the raw template text as well (currently
		// working on a patch for that, actually).
		this.text = this.text.replace( new RegExp( '\\{\\{\\s*afc submission\\s*(?:\\||[^{{}}]*|{{.*?}})*?\\}\\}' +
			// Also remove the AFCH-generated warning message, since if necessary the script will add it again
			'( <!-- กรุณาอย่าลบบรรทัดนี้! -->)?', 'gi' ), '' );

		// Nastiest hack of all time. As above, Parsoid would be great. Gotta wire it up asynchronously first, though.
		this.text = this.text.replace( /\{\{\s*afc comment[\s\S]+?\(\+07\)\}\}/gi, '' );

		// Remove horizontal rules that were added by AFCH after the comments
		this.text = this.text.replace( /^----+$/gm, '' );

		// Remove excess newlines created by AFC templates
		this.removeExcessNewlines();

		return this.text;
	};

	/**
	 * Removes old submission templates/comments and then adds new ones
	 * specified by `new`
	 *
	 * @param {string} newCode
	 * @return {string}
	 */
	AFCH.Text.prototype.updateAfcTemplates = function ( newCode ) {
		this.removeAfcTemplates();
		return this.prepend( newCode + '\n\n' );
	};

	AFCH.Text.prototype.updateCategories = function ( categories ) {
		// There's no "g" flag in categoryRegex, because we use it
		// to delete its matches in a loop. If it were global, then
		// it would internally keep track of lsatIndex - then given
		// two adjacent categories, only the first would get deleted
		let catIndex, match,
			text = this.text,
			categoryRegex = /\[\[:?(Category|หมวดหมู่):.*?\s*\]\]/i,
			newCategoryCode = '\n';

		// Create the wikicode block
		$.each( categories, ( _, category ) => {
			const trimmed = $.trim( category );
			if ( trimmed ) {
				newCategoryCode += '\n[[หมวดหมู่:' + trimmed + ']]';
			}
		} );

		match = categoryRegex.exec( text );

		// If there are no categories currently on the page,
		// just add the categories at the bottom
		if ( !match ) {
			text += newCategoryCode;
			// If there are categories on the page, remove them all, and
			// then add the new categories where the last category used to be
		} else {
			while ( match ) {
				catIndex = match.index;
				text = text.replace( match[ 0 ], '' );
				match = categoryRegex.exec( text );
			}

			text = text.substring( 0, catIndex ) + newCategoryCode + text.substring( catIndex );
		}

		this.text = text;
		return this.text;
	};

	AFCH.Text.prototype.updateShortDescription = function ( existingShortDescription, newShortDescription ) {
		const shortDescTemplateExists = /\{\{[Ss]hort ?desc(ription)?\s*\|/.test( this.text );
		const shortDescExists = !!existingShortDescription;

		if ( newShortDescription ) {
			// 1. No shortdesc - insert the one provided by user
			if ( !shortDescExists ) {
				this.prepend( '{{Short description|' + newShortDescription + '}}\n' );

			// 2. Shortdesc exists from {{short description}} template - replace it
			} else if ( shortDescExists && shortDescTemplateExists ) {
				this.text = this.text.replace( /\{\{[Ss]hort ?desc(ription)?\s*\|.*?\}\}\n*/g, '' );
				this.prepend( '{{Short description|' + newShortDescription + '}}\n' );

			// 3. Shortdesc exists, but not generated by {{short description}}. If the user
			//  has changed the value, save the new value
			} else if ( shortDescExists && existingShortDescription !== newShortDescription ) {
				this.prepend( '{{Short description|' + newShortDescription + '}}\n' );

			// 4. Shortdesc exists, but not generated by {{short description}}, and user hasn't changed the value
			} else {
				// Do nothing
			}
		} else {
			// User emptied the shortdesc field (or didn't exist from before): remove any existing shortdesc.
			// This doesn't remove any shortdesc that is generated by other templates
			this.text = this.text.replace( /\{\{[Ss]hort ?desc(ription)?\s*\|.*?\}\}\n*/g, '' );
		}
	};

	// Add the launch link
	$afchLaunchLink = $( mw.util.addPortletLink( AFCH.prefs.launchLinkPosition, 'javascript' + ':' + 'void(0)', 'ตรวจ (AFCH)',
		'afch-launch', 'ทบทวนฉบับร่างโดยใช้ afch-rewrite สำหรับวิกิพีเดียภาษาไทย', '1' ) );

	if ( AFCH.prefs.autoOpen &&
		// Don't autoload in userspace -- too many false positives
		AFCH.consts.pagename.indexOf( 'ผู้ใช้:' ) !== 0 &&
		// Only autoload if viewing or editing the page
		[ 'view', 'edit', null ].indexOf( AFCH.getParam( 'action' ) ) !== -1 &&
		!AFCH.getParam( 'diff' ) && !AFCH.getParam( 'oldid' ) ) {
		// Launch the script immediately if preference set
		createAFCHInstance();
	} else {
		// Otherwise, wait for a click (`one` to prevent spawning multiple panels)
		$afchLaunchLink.one( 'click', createAFCHInstance );
	}

	// Mark launch link for the old helper script as "old" if present on page
	$( '#p-cactions #ca-afcHelper > a' ).append( ' (เก่า)' );

	// If AFCH is destroyed via AFCH.destroy(),
	// remove the $afch window and the launch link
	AFCH.addDestroyFunction( () => {
		$afchLaunchLink.remove();

		// The $afch window might not exist yet; make
		// sure it does before trying to remove it :)
		if ( $afch && $afch.jquery ) {
			$afch.remove();
		}
	} );

	function createAFCHInstance() {
		/**
		 * global; wraps ALL afch-y things
		 */
		$afch = $( '<div>' )
			.addClass( 'afch' )
			.insertBefore( '#mw-content-text' )
			.append(
				$( '<div>' )
					.addClass( 'top-bar' )
					.append(
						// Back link appears on the left based on context
						$( '<div>' )
							.addClass( 'back-link' )
							.html( '&#x25c0; กลับไปที่ตัวเลือก' ) // back arrow
							.attr( 'title', 'ย้อนกลับ' )
							.addClass( 'hidden' )
							.on( 'click', () => {
								// Reload the review panel
								spinnerAndRun( setupReviewPanel );
							} ),

						// On the right, a close button
						$( '<div>' )
							.addClass( 'close-link' )
							.html( '&times;' )
							.on( 'click', () => {
								// DIE DIE DIE (...then allow clicks on the launch link again)
								$afch.remove();
								$afchLaunchLink
									.off( 'click' ) // Get rid of old handler
									.one( 'click', createAFCHInstance );
							} )
					)
			);

		/**
		 * global; wrapper for specific afch panels
		 */
		$afchWrapper = $( '<div>' )
			.addClass( 'panel-wrapper' )
			.appendTo( $afch )
			.append(
				// Build splash panel in JavaScript rather than via
				// a template so we don't have to wait for the
				// HTTP request to go through
				$( '<div>' )
					.addClass( 'review-panel' )
					.addClass( 'splash' )
					.append(
						$( '<div>' )
							.addClass( 'initial-header' )
							.text( 'กำลังโหลด AFCH ...' )
					)
			);

		// Now set up the review panel and replace it with actual content, not just a splash screen
		setupReviewPanel();

		// If the "Review" link is clicked again, just reload the main view
		$afchLaunchLink.on( 'click', () => {
			spinnerAndRun( setupReviewPanel );
		} );
	}

	function setupReviewPanel() {
		// Store this to a variable so we can wait for its success
		const loadViews = $.ajax( {
			type: 'GET',
			url: AFCH.consts.baseurl + '/tpl-submissions.js',
			dataType: 'text'
		} ).done( ( data ) => {
			afchViews = new AFCH.Views( data );
			afchViewer = new AFCH.Viewer( afchViews, $afchWrapper );
		} );

		afchPage = new AFCH.Page( AFCH.consts.pagename );
		afchSubmission = new AFCH.Submission( afchPage );

		// Set up messages for later
		setMessages();

		// Parse the page and load the view templates. When done,
		// continue with everything else.
		$.when(
			afchSubmission.parse(),
			loadViews
		).then( ( submission ) => {
			let extrasRevealed = false;

			// Render the base buttons view
			loadView( 'main', {
				title: submission.shortTitle,
				accept: submission.isCurrentlySubmitted,
				decline: submission.isCurrentlySubmitted,
				comment: true, // Comments are always okay!
				submit: !submission.isCurrentlySubmitted,
				alreadyUnderReview: submission.isUnderReview
			} );

			// Set up the extra options slide-out panel, which appears
			// when the user click on the chevron
			$afch.find( '#afchExtra .open' ).on( 'click', () => {
				const $extra = $afch.find( '#afchExtra' );

				if ( extrasRevealed ) {
					$extra.find( 'a' ).hide();
					$extra.stop().animate( { width: '20px' }, 100, 'swing', () => {
						extrasRevealed = false;
					} );
				} else {
					$extra.stop().animate( { width: '210px' }, 150, 'swing', () => {
						$extra.find( 'a' ).css( 'display', 'block' );
						extrasRevealed = true;
					} );
				}
			} );

			// Add preferences link
			AFCH.preferences.initLink( $afch.find( 'span.preferences-wrapper' ), 'การตั้งค่า' );

			// Set up click handlers
			$afch.find( '#afchAccept' ).on( 'click', () => {
				spinnerAndRun( showAcceptOptions );
			} );
			$afch.find( '#afchDecline' ).on( 'click', () => {
				spinnerAndRun( showDeclineOptions );
			} );
			$afch.find( '#afchComment' ).on( 'click', () => {
				spinnerAndRun( showCommentOptions );
			} );
			$afch.find( '#afchSubmit' ).on( 'click', () => {
				spinnerAndRun( showSubmitOptions );
			} );
			$afch.find( '#afchClean' ).on( 'click', () => {
				handleCleanup();
			} );
			$afch.find( '#afchMark' ).on( 'click', () => {
				handleMark( /* unmark */ submission.isUnderReview );
			} );

			// Load warnings about the page, then slide them in
			getSubmissionWarnings().done( ( warnings ) => {
				if ( warnings.length ) {
					// FIXME: CSS-based slide-in animation instead to avoid having
					// to use stupid hide() + removeClass() workaround?
					$afch.find( '.warnings' )
						.append( warnings )
						.hide().removeClass( 'hidden' )
						.slideDown();
				}
			} );

			// Get ท10 eligibility and when known, display relevant buttons...
			// but don't hold up the rest of the loading to do so
			submission.isG13Eligible().done( ( eligible ) => {
				$afch.find( '.g13-related' ).toggleClass( 'hidden', !eligible );
				$afch.find( '#afchG13' ).on( 'click', () => {
					handleG13();
				} );
				$afch.find( '#afchPostponeG13' ).on( 'click', () => {
					spinnerAndRun( showPostponeG13Options );
				} );
			} );
		} );
	}

	/**
	 * Loads warnings about the submission
	 *
	 * @return {jQuery}
	 */
	function getSubmissionWarnings() {
		const deferred = $.Deferred(),
			warnings = [];

		/**
		 * Adds a warning
		 *
		 * @param {string} message
		 * @param {string|boolean} actionMessage set to false to hide action link
		 * @param {Function|string} onAction function to call on success, or URL to browse to
		 */
		function addWarning( message, actionMessage, onAction ) {
			let $action,
				$warning = $( '<div>' )
					.addClass( 'afch-warning' )
					.text( message );

			if ( actionMessage !== false ) {
				$action = $( '<a>' )
					.addClass( 'link' )
					.text( '(' + ( actionMessage || 'แก้ไขหน้า' ) + ')' )
					.appendTo( $warning );

				if ( typeof onAction === 'function' ) {
					$action.on( 'click', onAction );
				} else {
					$action
						.attr( 'target', '_blank' )
						.attr( 'href', onAction || mw.util.getUrl( AFCH.consts.pagename, { action: 'edit' } ) );
				}
			}

			warnings.push( $warning );
		}

		function checkReferences() {
			const deferred = $.Deferred();

			afchPage.getText( false ).done( ( text ) => {
				const refBeginRe = /<\s*ref.*?\s*>/ig,
					// If the ref is closed already, we don't want it
					// (returning true keeps the item, false removes it)
					refBeginMatches = $.grep( text.match( refBeginRe ) || [], ( ref ) => ref.indexOf( '/>', ref.length - 2 ) === -1 ),
					refEndRe = /<\/\s*ref\s*>/ig,
					refEndMatches = text.match( refEndRe ) || [],

					reflistRe = /({{(ref(erence)?(\s|-)?list|listaref|refs|footnote|reference|referencias|รายการอ้างอิง)(?:{{[^{}]*}}|[^}{])*}})|(<\s*references\s*\/?>)/ig,
					hasReflist = reflistRe.test( text ),

					// This isn't as good as a tokenizer, and believes that <ref> foo </b> is
					// completely correct... but it's a good intermediate level solution.
					malformedRefs = text.match( /<\s*ref\s*[^/]*>?<\s*[^/]*\s*ref\s*>/ig ) || [];

				// Uneven (/unclosed) <ref> and </ref> tags
				if ( refBeginMatches.length !== refEndMatches.length ) {
					addWarning( 'ฉบับร่างนี้มี <ref>' +
						( refBeginMatches.length > refEndMatches.length ? 'ที่ไม่ได้ปิด' : 'ที่ไม่สมดุล' ) );
				}

				// <ref>1<ref> instead of <ref>1</ref> detection
				if ( malformedRefs.length ) {
					addWarning( 'ฉบับร่างมีการใช้ <ref> ที่ไม่ถูกต้อง', 'ดูรายละเอียด', function () {
						const $warningDiv = $( this ).parent();
						const $malformedRefWrapper = $( '<div>' )
							.addClass( 'malformed-refs' )
							.appendTo( $warningDiv );

						// Show the relevant code snippets
						$.each( malformedRefs, ( _, ref ) => {
							$( '<div>' )
								.addClass( 'code-wrapper' )
								.append( $( '<pre>' ).text( ref ) )
								.appendTo( $malformedRefWrapper );
						} );

						// Now change the "View details" link to behave as a normal toggle for .malformed-refs
						AFCH.makeToggle( '.malformed-refs-toggle', '.malformed-refs', 'ดูรายละเอียด', 'ซ่อนรายละเอียด' );

						return false;
					} );
				}

				// <ref> after {{reflist}}
				if ( hasReflist ) {
					if ( refBeginRe.test( text.substring( reflistRe.lastIndex ) ) ) {
						addWarning( 'มีการใช้แท็ก <ref> ที่ไม่ได้อยู่ก่อนรายการอ้างอิง คุณอาจไม่เห็นรายการอ้างอิงทั้งหมด' );
					}
				}

				// <ref> without {{reflist}}
				if ( refBeginMatches.length && !hasReflist ) {
					addWarning( 'ฉบับร่างมีการใช้แท็ก <ref> แต่ไม่มีการใช้รายการอ้างอิง คุณอาจไม่เห็นรายการอ้างอิงทั้งหมด' );
				}

				deferred.resolve();
			} );

			return deferred;
		}

		function checkDeletionLog() {
			const deferred = $.Deferred();

			// Don't show deletion notices for "sandbox" to avoid useless
			// information when reviewing user sandboxes and the like
			// if ( [ 'sandbox', 'ทดลองเขียน', 'กระบะทราย' ].shortTitle.toLowerCase() === -1 ) {
			if (['sandbox', 'ทดลองเขียน', 'กระบะทราย'].indexOf(afchSubmission.shortTitle.toLowerCase()) !== -1) {
				deferred.resolve();
				return deferred;
			}

			AFCH.api.get( {
				action: 'query',
				list: 'logevents',
				leprop: 'user|timestamp|comment',
				leaction: 'delete/delete',
				letype: 'delete',
				lelimit: 10,
				letitle: afchSubmission.shortTitle
			} ).done( ( data ) => {
				const rawDeletions = data.query.logevents;

				if ( !rawDeletions.length ) {
					deferred.resolve();
					return;
				}

				addWarning( 'หน้า "' + afchSubmission.shortTitle + '" ได้ถูกลบ ' + ( rawDeletions.length === 10 ? 'มากกว่า' : '' ) + rawDeletions.length +
					' ครั้ง' + ( rawDeletions.length > 1 ? 's' : '' ), 'ดูปูมการลบ', function () {
					const $toggleLink = $( this ).addClass( 'deletion-log-toggle' ),
						$warningDiv = $toggleLink.parent(),
						deletions = [];

					$.each( rawDeletions, ( _, deletion ) => {
						deletions.push( {
							timestamp: deletion.timestamp,
							relativeTimestamp: AFCH.relativeTimeSince( deletion.timestamp ),
							deletor: deletion.user,
							deletorLink: mw.util.getUrl( 'ผู้ใช้:' + deletion.user ),
							reason: AFCH.convertWikilinksToHTML( deletion.comment )
						} );
					} );

					$( afchViews.renderView( 'warning-deletions-table', { deletions: deletions } ) )
						.addClass( 'deletion-log' )
						.appendTo( $warningDiv );

					// ...and now convert the link into a toggle which simply hides/shows the div
					AFCH.makeToggle( '.deletion-log-toggle', '.deletion-log', 'ดูปูมการลบ', 'ซ่อนปูมการลบ' );

					return false;
				} );

				deferred.resolve();

			} );

			return deferred;
		}

		function checkReviewState() {
			let reviewer, isOwnReview;

			if ( afchSubmission.isUnderReview ) {
				isOwnReview = afchSubmission.params.reviewer === AFCH.consts.user;

				if ( isOwnReview ) {
					reviewer = 'คุณ';
				} else {
					reviewer = afchSubmission.params.reviewer || 'ใครบางคน';
				}

				addWarning( reviewer + ( afchSubmission.params.reviewts ?
					'ได้เริ่มทำการตรวจฉบับร่างนี้แล้วเมื่อ ' + AFCH.relativeTimeSince( afchSubmission.params.reviewts ) :
					'ได้ตรวจฉบับร่างนี้ไปแล้ว' ),
				isOwnReview ? 'เลิกทำเครื่องหมายว่ากำลังตรวจ' : 'ดูประวัติหน้า',
				isOwnReview ? () => {
					handleMark( /* unmark */ true );
				} : mw.util.getUrl( AFCH.consts.pagename, { action: 'history' } ) );
			}
		}

		function checkLongComments() {
			const deferred = $.Deferred();

			afchPage.getText( false ).done( ( rawText ) => {
				const
					// Simulate cleanUp first so that we don't warn about HTML
					// comments that the script will remove anyway in the future
					text = ( new AFCH.Text( rawText ) ).cleanUp( true ),
					longCommentRegex = /(?:<![ \r\n\t]*--)([^-]|[\r\n]|-[^-]){30,}(?:--[ \r\n\t]*>)?/g,
					longCommentMatches = text.match( longCommentRegex ) || [],
					numberOfComments = longCommentMatches.length;

				if ( numberOfComments ) {
					addWarning( 'หน้านี้มีคอมเมนต์ HTML ' +
						' ที่ยาวกว่า 30 ตัวอักษร', 'ดูคอมเมนต์', function () {
						const $warningDiv = $( this ).parent(),
							$commentsWrapper = $( '<div>' )
								.addClass( 'long-comments' )
								.appendTo( $warningDiv );

						// Show the relevant code snippets
						$.each( longCommentMatches, ( _, comment ) => {
							$( '<div>' )
								.addClass( 'code-wrapper' )
								.append( $( '<pre>' ).text( $.trim( comment ) ) )
								.appendTo( $commentsWrapper );
						} );

						// Now change the "View comment" link to behave as a normal toggle for .long-comments
						AFCH.makeToggle( '.long-comment-toggle', '.long-comments',
							'ดูคอมเมนต์', 'ซ่อนคอมเมนต์' );

						return false;
					} );
				}

				deferred.resolve();
			} );

			return deferred;
		}

		function checkForCopyvio() {
			return AFCH.api.get( {
				action: 'pagetriagelist',
				page_id: mw.config.get( 'wgArticleId' )
			} ).then( ( json ) => {
				const triageInfo = json.pagetriagelist.pages[ 0 ];
				if ( triageInfo && Number( triageInfo.copyvio ) === mw.config.get( 'wgCurRevisionId' ) ) {
					addWarning(
						'This submission may contain copyright violations',
						'CopyPatrol',
						'https://copypatrol.wmcloud.org/en?filter=all&searchCriteria=page_exact&searchText=' + encodeURIComponent( afchPage.rawTitle ) + '&drafts=1&revision=' + mw.config.get( 'wgCurRevisionId' ), '_blank'
					);
				}
			} );
		}

		function checkForBlocks() {
			return afchSubmission.getSubmitter().then( ( creator ) => checkIfUserIsBlocked( creator ).then( ( blockData ) => {
				if ( blockData !== null ) {
					let date = 'infinity';
					if ( blockData.expiry !== 'infinity' ) {
						const data = new Date( blockData.expiry );
						const monthNames = [ 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม' ];
						date = data.getUTCDate() + ' ' + monthNames[ data.getUTCMonth() ] + ' ' + (data.getUTCFullYear() + 543) + ' ' + data.getUTCHours() + ':' + data.getUTCMinutes() + ' UTC';
					}
					const warning = creator + 'ซึ่งเป็นผู้ส่งฉบับร่างถูกบล็อกโดย ' + blockData.by + (date === 'infinity' ? ' โดยไม่มีกำหนดปลดบล็อก' : ' จนถึง ' + date) + ' เนื่องจาก: ' + blockData.reason;
					addWarning( warning );
				}
			} ) );
		}

		$.when(
			checkReferences(),
			checkDeletionLog(),
			checkReviewState(),
			checkLongComments(),
			// checkForCopyvio(),
			checkForBlocks()
		).then( () => {
			deferred.resolve( warnings );
		} );

		return deferred;
	}

	/**
	 * Stores useful strings to AFCH.msg
	 */
	function setMessages() {
		const headerBegin = '== การส่งฉบับร่างของคุณกับ[[วิกิพีเดีย:ว่าที่บทความ|ว่าที่บทความ]]: ';
		AFCH.msg.set( {
			// $1 = article name
			// $2 = article class or '' if not available
			'accepted-submission': headerBegin +
				'หน้า [[$1]] ได้รับการยอมรับแล้ว ==\n{{subst:Afc talk|$1|class=$2|sig=~~~~}}',

			// $1 = full submission title
			// $2 = short title
			// $3 = copyright violation ('yes'/'no')
			// $4 = decline reason code
			// $5 = decline reason additional parameter
			// $6 = second decline reason code
			// $7 = additional parameter for second decline reason
			// $8 = additional comment
			'declined-submission': headerBegin +
				'[[$1|$2]] ({{subst:CURRENTDAY}} {{subst:CURRENTMONTHNAME}}) ==\n{{subst:Afc decline|full=$1|cv=$3|reason=$4|details=$5|reason2=$6|details2=$7|comment=$8|sig=yes}}',

			// $1 = full submission title
			// $2 = short title
			// $3 = reject reason code ('e' or 'n')
			// $4 = reject reason details (blank for now)
			// $5 = second reject reason code
			// $6 = second reject reason details
			// $7 = comment by reviewer
			'rejected-submission': headerBegin +
				'[[$1|$2]] ({{subst:CURRENTMONTHNAME}} {{subst:CURRENTDAY}}) ==\n{{subst:Afc reject|full=$1|reason=$3|details=$4|reason2=$5|details2=$6|comment=$7|sig=yes}}',

			// $1 = article name
			'comment-on-submission': '{{subst:afc notification|comment|article=$1}}',

			// $1 = article name
			'g13-submission': '{{subst:Db-afc-notice|$1}} ~~~~',

			'teahouse-invite': '{{subst:Wikipedia:Teahouse/AFC invitation|sign=~~~~}}'
		} );
	}

	/**
	 * Clear the viewer, set up the status log, and
	 * then update the button text
	 *
	 * @param {string} actionTitle optional, if there is no content available and the
	 *                             script has to load a new view, this will be its title
	 * @param {string} actionClass optional, if there is no content available and the
	 *                             script has to load a new view, this will be the class
	 *                             applied to it
	 */
	function prepareForProcessing( actionTitle, actionClass ) {
		let $content = $afch.find( '#afchContent' ),
			$submitBtn = $content.find( '#afchSubmitForm' );

		// If we can't find a submit button or a content area, load
		// a new temporary "processing" stage instead
		if ( !( $submitBtn.length || $content.length ) ) {
			loadView( 'quick-action-processing', {
				actionTitle: actionTitle || 'กำลังดำเนินการ',
				actionClass: actionClass || 'other-action'
			} );

			// Now update the variables
			$content = $afch.find( '#afchContent' );
			$submitBtn = $content.find( '#afchSubmitForm' );
		}

		// Empty the content area except for the button...
		$content.contents().not( $submitBtn ).remove();

		// ...and set up the status log in its place
		AFCH.status.init( '#afchContent' );

		// Update the button show the `running` text
		$submitBtn
			.text( $submitBtn.data( 'running' ) )
			.addClass( 'disabled' )
			.off( 'click' );

		// Handler will run after the main AJAX requests complete
		setupAjaxStopHandler();
	}

	/**
	 * Sets up the `ajaxStop` handler which runs after all ajax
	 * requests are complete and changes the text of the button
	 * to "Done", shows a link to the next submission and
	 * auto-reloads the page.
	 */
	function setupAjaxStopHandler() {
		$( document ).on( 'ajaxStop', () => {
			$afch.find( '#afchSubmitForm' )
				.text( 'สำเร็จ' )
				.append(
					' ',
					$( '<a>' )
						.attr( 'id', 'reloadLink' )
						.addClass( 'text-smaller' )
						.attr( 'href', mw.util.getUrl() )
						.text( '(รีโหลด...)' )
				);

			// Show a link to the next random submissions
			// We need "new" here because Element uses "this." and needs the right context.
			// eslint-disable-next-line no-new
			new AFCH.status.Element( 'ทำต่อหรือไม่ $1, $2, or $3 &raquo;', {
				$1: AFCH.makeLinkElementToCategory( 'ฉบับร่างรอตรวจ', 'สุ่มฉบับร่าง' ),
				$2: AFCH.makeLinkElementToCategory( 'ฉบับร่างรอตรวจเรียงตามอายุ/0 วันก่อน', 'ใหม่ล่าสุด' ),
				$3: AFCH.makeLinkElementToCategory( 'ฉบับร่างรอตรวจเรียงตามอายุ/เก่ามาก', 'เก่าสุด (>6 เดือน)' )
			} );

			// Also, automagically reload the page in place
			$( '#mw-content-text' ).load( AFCH.consts.pagelink + ' #mw-content-text', () => {
				$afch.find( '#reloadLink' ).text( '(รีโหลด)' );
				// Fire the hook for new page content
				mw.hook( 'wikipage.content' ).fire( $( '#mw-content-text' ) );
			} );

			// Stop listening to ajaxStop events; otherwise these can stack up if
			// the user goes back to perform another action, for example
			$( document ).off( 'ajaxStop' );
		} );
	}

	/**
	 * Adds handler for when the accept/decline/etc form is submitted
	 * that calls a given function and passes an object to the function
	 * containing data from all .afch-input elements in the dom.
	 *
	 * Also sets up the viewer for the "processing" stage.
	 *
	 * @param {Function} fn function to call with data
	 * @param {Object} extraData more data to pass; will be inserted
	 *                           into the data passed to `fn`
	 */
	function addFormSubmitHandler( fn, extraData ) {
		$afch.find( '#afchSubmitForm' ).on( 'click', () => {
			const data = {};

			// Provide page text; use cache created after afchSubmission.parse()
			afchPage.getText( false ).done( ( text ) => {
				data.afchText = new AFCH.Text( text );

				// Also provide the values for each afch-input element
				$.extend( data, AFCH.getFormValues( $afch.find( '.afch-input' ) ) );

				// Also provide extra data
				$.extend( data, extraData );

				checkForEditConflict().then( ( editConflict ) => {
					if ( editConflict ) {
						showEditConflictMessage();
						return;
					}

					// Hide the HTML form. Show #afchStatus messages
					prepareForProcessing();

					// Now finally call the applicable handler
					fn( data );
				} );
			} );
		} );
	}

	/**
	 * Displays a spinner in the main content area and then
	 * calls the passed function
	 *
	 * @param {Function} fn function to call when spinner has been displayed
	 */
	function spinnerAndRun( fn ) {
		let $spinner, $container = $afch.find( '#afchContent' );

		// Add a new spinner if one doesn't already exist
		if ( !$container.find( '.mw-spinner' ).length ) {

			$spinner = $.createSpinner( {
				size: 'large',
				type: 'block'
			} )
				// Set the spinner's dimensions equal to the viewers's dimensions so that
				// the current scroll position is not lost when emptied
				.css( {
					height: $container.height(),
					width: $container.width()
				} );

			$container.empty().append( $spinner );
		}

		if ( typeof fn === 'function' ) {
			fn();
		}
	}

	/**
	 * Loads a new view
	 *
	 * @param {string} name view to be loaded
	 * @param {Object} data data to populate the view with
	 * @param {Function} callback function to call when view is loaded
	 */
	function loadView( name, data, callback ) {
		// Show the back button if we're not loading the main view
		$afch.find( '.back-link' ).css( 'color', name === 'comment' ? 'black' : 'white' );
		$afch.find( '.back-link' ).toggleClass( 'hidden', name === 'main' );
		afchViewer.loadView( name, data );
		if ( callback ) {
			callback();
		}
	}

	// These functions show the options before doing something
	// to a submission.

	function showAcceptOptions() {
		/**
		 * If possible, use the session storage to get the WikiProject list.
		 * If it hasn't been cached already, load it manually and then cache
		 *
		 * @return {jQuery.Deferred}
		 */
		function loadWikiProjectList() {
			let deferred = $.Deferred(),
				// Left over from when a new version of AFCH would invalidate the WikiProject cache. The lsKey doesn't change nowadays though.
				lsKey = 'mw-afch-wikiprojects-2',
				wikiProjects = mw.storage.getObject( lsKey );

			if ( wikiProjects ) {
				deferred.resolve( wikiProjects );
			} else {
				wikiProjects = [];
				$.ajax( {
					url: mw.config.get( 'wgServer' ) + '/w/index.php?title=%E0%B8%A7%E0%B8%B4%E0%B8%81%E0%B8%B4%E0%B8%9E%E0%B8%B5%E0%B9%80%E0%B8%94%E0%B8%B5%E0%B8%A2:' +
						'%E0%B9%82%E0%B8%84%E0%B8%A3%E0%B8%87%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%A7%E0%B8%B4%E0%B8%81%E0%B8%B4/%E0%B9%81%E0%B8%A1%E0%B9%88%E0%B9%81%E0%B8' +
						'%9A%E0%B8%9A%E0%B9%82%E0%B8%84%E0%B8%A3%E0%B8%87%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%A7%E0%B8%B4%E0%B8%81%E0%B8%B4.json&action=raw&ctype=text/json',
					dataType: 'json'
				} ).done( ( projectData ) => {
					$.each( projectData, ( display, template ) => {
						wikiProjects.push( {
							displayName: display,
							templateName: template
						} );
					} );

					// If possible, cache the WikiProject data!
					if ( !mw.storage.setObject( lsKey, wikiProjects, ( 7 * 24 * 60 * 60 ) ) ) {
						AFCH.log( 'ไม่สามารถแคชรายชื่อโครงการวิกิได้.' );
					}

					deferred.resolve( wikiProjects );
				} ).fail( ( jqxhr, textStatus, errorThrown ) => {
					console.error( 'ไม่สามารถ parse รายการโครงการวิกิได้: ', textStatus, errorThrown );
				} );
			}

			return deferred;
		}

		const existingWikiProjectsPromise = $.when(
			loadWikiProjectList(),
			new AFCH.Page( 'คุยเรื่องฉบับร่าง:' + afchSubmission.shortTitle ).getTemplates()
		).then( ( wikiProjects, templates ) => {
			let templateNames = templates.map( ( template ) => template.target.trim().toLowerCase() );

			// Turn the WikiProject list into an Object to make lookups faster
			let wikiProjectMap = {};
			for ( let projIdx = 0; projIdx < wikiProjects.length; projIdx++ ) {
				wikiProjectMap[ wikiProjects[ projIdx ].templateName.toLowerCase() ] = {
					displayName: wikiProjects[ projIdx ].displayName,
					templateName: wikiProjects[ projIdx ].templateName,
					alreadyOnPage: false
				};
			}

			let alreadyHasWPBio = false;

			if ( templates.length === 0 ) {
				return {
					alreadyHasWPBio: alreadyHasWPBio,
					wikiProjectMap: wikiProjectMap
				};
			}

			let otherTemplates = [];
			for ( let tplIdx = 0; tplIdx < templateNames.length; tplIdx++ ) {
				if ( wikiProjectMap.hasOwnProperty( templateNames[ tplIdx ] ) ) {
					wikiProjectMap[ templateNames[ tplIdx ] ].alreadyOnPage = true;
					// TODO: add thwiki equalment wikiProjrct here
				} else if ( templateNames[ tplIdx ] === 'wikiproject biography' ) {
					alreadyHasWPBio = true;
				} else {
					otherTemplates.push( templateNames[ tplIdx ] );
				}
			}

			// If any templates weren't in the WikiProject map, check if they were redirects
			if ( otherTemplates.length > 0 ) {
				var titles = otherTemplates.map((n) => 'แม่แบบ:' + n);
				titles = titles.slice( 0, 50 ); // prevent API error by capping max # of titles at 50
				titles = titles.join( '|' );
				return AFCH.api.post( {
					action: 'query',
					titles: titles,
					redirects: 'true'
				} ).then( ( data ) => {
					let existingWPBioTemplateName = null;
					if ( data.query && data.query.redirects && data.query.redirects.length > 0 ) {
						let redirs = data.query.redirects;
						for ( let redirIdx = 0; redirIdx < redirs.length; redirIdx++ ) {
							let redir = redirs[ redirIdx ].to.slice( 'แม่แบบ:'.length ).toLowerCase();
							let originalName = redirs[ redirIdx ].from.slice( 'แม่แบบ:'.length );
							if ( wikiProjectMap.hasOwnProperty( redir ) ) {
								wikiProjectMap[ redir ].alreadyOnPage = true;
								wikiProjectMap[ redir ].realTemplateName = originalName;
								// TODO: thwiki did not has this
							} else if ( redir === 'wikiproject biography' ) {
								alreadyHasWPBio = true;
								existingWPBioTemplateName = originalName;
							}
						}
					}
					return {
						alreadyHasWPBio: alreadyHasWPBio,
						wikiProjectMap: wikiProjectMap,
						existingWPBioTemplateName: existingWPBioTemplateName
					};
				} );
			} else {
				return {
					alreadyHasWPBio: alreadyHasWPBio,
					wikiProjectMap: wikiProjectMap
				};
			}
		} );

		$.when(
			afchPage.getText( false ),
			existingWikiProjectsPromise,
			afchPage.getCategories( /* useApi */ false, /* includeCategoryLinks */ true )
		).then( ( pageText, existingWikiProjectsResult, categories ) => {
			const alreadyHasWPBio = existingWikiProjectsResult.alreadyHasWPBio,
				wikiProjectMap = existingWikiProjectsResult.wikiProjectMap,
				existingWPBioTemplateName = existingWikiProjectsResult.existingWPBioTemplateName;
			const existingWikiProjects = []; // already on draft's talk page
			$.each( wikiProjectMap, ( lowercaseTemplateName, obj ) => {
				if ( obj.alreadyOnPage ) {
					existingWikiProjects.push( obj );
				}
			} );
			const hasWikiProjects = Object.keys( wikiProjectMap ).length > 0;
			if ( !hasWikiProjects ) {
				mw.notify( 'ไม่สามารถโหลดรายการโครงการวิกิได้' );
			}
			const wikiProjectObjs = Object.keys( wikiProjectMap ).map( ( key ) => wikiProjectMap[ key ] );

			loadView( 'accept', {
				newTitle: afchSubmission.shortTitle,
				hasWikiProjects: hasWikiProjects,
				wikiProjects: wikiProjectObjs,
				categories: categories,
				// Only offer to patrol the page if not already patrolled (in other words, if
				// the "Mark as patrolled" link can be found in the DOM)
				showPatrolOption: !!$afch.find( '.patrollink' ).length
			}, () => {
				$afch.find( '#newAssessment' ).chosen( {
					allow_single_deselect: true,
					disable_search: true,
					width: '140px',
					placeholder_text_single: 'กดเพื่อเลือก'
				} );

				// If draft is assessed as stub, show stub sorting
				// interface using User:SD0001/StubSorter.js
				$afch.find( '#newAssessment' ).on( 'change', function () {
					const isClassStub = $( this ).val() === 'stub';
					$afch.find( '#stubSorterWrapper' ).toggleClass( 'hidden', !isClassStub );
					if ( isClassStub ) {
						if ( mw.config.get( 'wgDBname' ) !== 'enwiki' ) {
							// we kown that stubsorter is only available on enwiki
							return;
							// console.warn( 'no stub sorting script available for this language wiki' );
						}

						if ( $afch.find( '#stubSorterContainer' ).html() === '' ) {
							mw.hook( 'StubSorter_activate' ).fire( $afch.find( '#stubSorterContainer' ) );
							let promise = $.when();
							const wasStubSorterActivated = $afch.find( '#stubSorterContainer' ).html() !== '';
							if ( !wasStubSorterActivated ) {
								promise = mw.loader.getScript( 'https://en.wikipedia.org/w/index.php?title=User:SD0001/StubSorter.js&action=raw&ctype=text/javascript' );
							}

							promise.then( () => {
								if ( !wasStubSorterActivated ) {
									mw.hook( 'StubSorter_activate' ).fire( $afch.find( '#stubSorterContainer' ) );
								}

								$( '#stub_sorter_select_chosen' ).css( 'width', '' );
								$( '#stub-sorter-select' ).addClass( 'afch-input' );

								if ( /\{\{[^{ ]*[sS]tub(\|.*?)?\}\}\s*/.test( pageText ) ) {
									$afch.find( '#newAssessment' ).val( 'stub' ).trigger( 'chosen:updated' ).trigger( 'change' );
								}
							} );
						}
					}
				} );

				$afch.find( '#newWikiProjects' ).chosen( {
					placeholder_text_multiple: 'พิมพ์ชื่อโครงการวิกิเพื่อกรอง...',
					no_results_text: 'ไม่พบโครงการวิกินี้ในฐานข้อมูล',
					width: '350px'
				} );

				// Extend the chosen menu for new WikiProjects. We hackily show a
				// "Click to manually add {{PROJECT}}" link -- sadly, jquery.chosen
				// doesn't support this natively.
				$afch.find( '#newWikiProjects_chzn input' ).on( 'keyup', function () {
					const $chzn = $afch.find( '#newWikiProjects_chzn' ),
						$input = $( this ),
						newProject = $input.val(),
						$noResults = $chzn.find( 'li.no-results' );

					// Only show "Add {{PROJECT}}" link if there are no results
					if ( $noResults.length ) {
						$( '<div>' )
							.appendTo( $noResults.empty() )
							.text( 'ไม่พบโครงการวิกิที่ตรงกันในฐานข้อมูล ' )
							.append(
								$( '<a>' )
									.text( 'กดที่นี่เพื่อเพิ่ม {{' + newProject + '}} ด้วยมือที่หน้ารายการโครงการวิกิ' )
									.on( 'click', () => {
										const $wikiprojects = $afch.find( '#newWikiProjects' );

										$( '<option>' )
											.attr( 'value', newProject )
											.attr( 'selected', true )
											.text( newProject )
											.appendTo( $wikiprojects );

										$wikiprojects.trigger( 'liszt:updated' );
										$input.val( '' );
									} )
							);
					}
				} );

				$afch.find( '#newCategories' ).chosen( {
					placeholder_text_multiple: 'พิมพ์ชื่อหมวดหมู่ที่นี่...',
					width: '350px'
				} );

				// Offer dynamic category suggestions!
				// Since jquery.chosen doesn't natively support dynamic results,
				// we sneakily inject some dynamic suggestions instead. Consider
				// switching to something like Select2 to avoid this hackery...
				$afch.find( '#newCategories_chosen input' ).on( 'keyup', function ( e ) {
					const $input = $( this ),
						prefix = $input.val(),
						$categories = $afch.find( '#newCategories' );

					// Ignore up/down keys to allow users to navigate through the suggestions,
					// and don't show results when an empty string is provided
					if ( [ 38, 40 ].indexOf( e.which ) !== -1 || !prefix ) {
						return;
					}

					// The worst hack. Because Chosen keeps messing with the
					// width of the text box, keep on resetting it to 100%
					$input.css( 'width', '100%' );
					$input.parent().css( 'width', '100%' );

					AFCH.api.getCategoriesByPrefix( prefix ).done( ( categories ) => {

						// Reset the text box width again
						$input.css( 'width', '100%' );
						$input.parent().css( 'width', '100%' );

						// If the input has changed since we started searching,
						// don't show outdated results
						if ( $input.val() !== prefix ) {
							return;
						}

						// Clear existing suggestions
						$categories.children().not( ':selected' ).remove();

						// Now, add the new suggestions
						$.each( categories, ( _, category ) => {
							$( '<option>' )
								.attr( 'value', category )
								.text( category )
								.appendTo( $categories );
						} );

						// We've changed the <select>, now tell Chosen to
						// rebuild the visible list
						$categories.trigger( 'liszt:updated' );
						$categories.trigger( 'chosen:updated' );
						$input.val( prefix );
						$input.css( 'width', '100%' );
						$input.parent().css( 'width', '100%' );
					} );
				} );

				// Show bio options if Biography option checked
				$afch.find( '#isBiography' ).on( 'change', function () {
					$afch.find( '#bioOptionsWrapper' ).toggleClass( 'hidden', !this.checked );
				} );
				if ( alreadyHasWPBio ) {
					$afch.find( '#isBiography' ).prop( 'checked', true ).trigger( 'change' );
				}

				function prefillBiographyDetails() {
					let titleParts;

					// Prefill `LastName, FirstName` for Biography if the page title is two words
					// after removing any trailing parentheticals (likely disambiguation), and
					// therefore probably safe to asssume in a `FirstName LastName` format.
					const title = afchSubmission.shortTitle.replace( / \([\s\S]*?\)$/g, '' );
					titleParts = title.split( ' ' );
					if ( titleParts.length === 2 ) {
						$afch.find( '#subjectName' ).val( titleParts[ 1 ] + ', ' + titleParts[ 0 ] );
					}
				}
				prefillBiographyDetails();

				// Ask for the month/day IF the birth year has been entered
				$afch.find( '#birthYear' ).keyup( function () {
					$afch.find( '#birthMonthDayWrapper' ).toggleClass( 'hidden', !this.value.length );
				} );

				// Ask for the month/day IF the death year has been entered
				$afch.find( '#deathYear' ).keyup( function () {
					$afch.find( '#deathMonthDayWrapper' ).toggleClass( 'hidden', !this.value.length );
				} );

				// If subject is dead, show options for death details
				$afch.find( '#lifeStatus' ).on( 'change', function () {
					$afch.find( '#deathWrapper' ).toggleClass( 'hidden', $( this ).val() !== 'dead' );
				} );

				// Show an error if the page title already exists in the mainspace,
				// or if the title is create-protected and user is not an admin
				$afch.find( '#newTitle' ).on( 'keyup', function () {
					let page,
						linkToPage,
						$field = $( this ),
						$status = $afch.find( '#titleStatus' ),
						$submitButton = $afch.find( '#afchSubmitForm' ),
						value = $field.val();

					// Reset to a pure state
					$field.removeClass( 'bad-input' );
					$status.text( '' );
					$submitButton
						.removeClass( 'disabled' )
						.css( 'pointer-events', 'auto' )
						.text( 'ให้ผ่านและเผยแพร่' );

					// If there is no value, die now, because otherwise mw.Title
					// will throw an exception due to an invalid title
					if ( !value ) {
						return;
					}
					page = new AFCH.Page( value );
					linkToPage = AFCH.jQueryToHtml( AFCH.makeLinkElementToPage( page.rawTitle ) );

					AFCH.api.get( {
						action: 'query',
						titles: 'พูดคุย:' + page.rawTitle
					} ).done( ( data ) => {
						if ( !data.query.pages.hasOwnProperty( '-1' ) ) {
							$status.html( 'หน้าพูดคุย "' + linkToPage + '" มีอยู่แล้ว' );
						}
					} );

					$.when(
						AFCH.api.get( {
							action: 'titleblacklist',
							tbtitle: page.rawTitle,
							tbaction: 'create',
							tbnooverride: true
						} ),
						AFCH.api.get( {
							action: 'query',
							prop: 'info',
							inprop: 'protection',
							titles: page.rawTitle
						} )
					).then( ( rawBlacklist, rawInfo ) => {
						let errorHtml, buttonText;

						// Get just the result, not the Promise object
						let blacklistResult = rawBlacklist[ 0 ],
							infoResult = rawInfo[ 0 ];

						const pageAlreadyExists = !infoResult.query.pages.hasOwnProperty( '-1' );

						const pages = infoResult && infoResult.query && infoResult.query.pages && infoResult.query.pages;
						const firstPageInObject = Object.values( pages )[ 0 ];
						const pageIsRedirect = firstPageInObject && ( 'redirect' in firstPageInObject );

						if ( pageAlreadyExists && pageIsRedirect ) {
							const linkToRedirect = AFCH.jQueryToHtml( AFCH.makeLinkElementToPage( page.rawTitle, null, null, true ) );
							errorHtml = '<br />ว้า ดูเหมือนว่าหน้า "' + linkToRedirect + '" จะมีอยู่แล้วแต่เป็นหน้าเปลี่ยนทาง <span id="afch-redirect-notification">คุณต้องการแจ้งลบก่อนแล้วยอมรับฉบับร่างนี้ภายหลังหรือไม่ <a id="afch-redirect-tag-speedy">ได้เลย</a> / <a id="afch-redirect-abort">ยังก่อน</a></span>';
							buttonText = 'มีบทความชื่อนี้อยู่แล้ว';
						} else if ( pageAlreadyExists ) {
							errorHtml = 'ว้า ดูเหมือนว่าบทความ "' + linkToPage + '" จะมีอยู่แล้ว';
							buttonText = 'ชื่อบทความที่เสนอมามีอยู่แล้ว';
						} else {
							// If the page doesn't exist but IS create-protected and the
							// current reviewer is not an admin, also display an error
							// FIXME: offer one-click request unprotection?
							$.each( infoResult.query.pages[ '-1' ].protection, ( _, entry ) => {
								if ( entry.type === 'create' && entry.level === 'sysop' &&
									$.inArray( 'sysop', mw.config.get( 'wgUserGroups' ) ) === -1 ) {
									errorHtml = 'แย่แล้ว บทความ "' + linkToPage + '" ถูกล็อกสร้าง คุณจำเป็นต้องส่งคำขอยกเลิกการป้องกันสร้างหน้า';
									buttonText = 'ชื่อหน้าที่เสนอมาถูกล็อกสร้าง';
								}
							} );
						}

						// Now check the blacklist result, but if another error already exists,
						// don't bother showing this one too
						blacklistResult = blacklistResult.titleblacklist;
						if ( !errorHtml && blacklistResult.result === 'blacklisted' ) {
							errorHtml = '?!!??! ' + blacklistResult.reason.replace( /\s+/g, ' ' );
							buttonText = 'ชื่อบทความที่เสนอมาตรงกับบัญชีดำห้ามสร้าง';
						}

						if ( !errorHtml ) {
							return;
						}

						// Add a red border around the input field
						$field.addClass( 'bad-input' );

						// Show the error message
						$status.html( errorHtml );

						// Add listener for the "Do you want to tag it for speedy deletion so you can accept this draft later?" "yes" link.
						$( '#afch-redirect-tag-speedy' ).on( 'click', () => {
							handleAcceptOverRedirect( page.rawTitle );
						} );

						// Add listener for the "Do you want to tag it for speedy deletion so you can accept this draft later?" "no" link.
						$( '#afch-redirect-abort' ).on( 'click', () => {
							$( '#afch-redirect-notification' ).hide();
						} );

						// Disable the submit button and show an error in its place
						$submitButton
							.addClass( 'disabled' )
							.css( 'pointer-events', 'none' )
							.text( buttonText );
					} );
				} );

				// Update titleStatus
				$afch.find( '#newTitle' ).trigger( 'keyup' );

			} );

			addFormSubmitHandler( handleAccept, {
				existingWikiProjects: existingWikiProjects,
				alreadyHasWPBio: alreadyHasWPBio,
				existingWPBioTemplateName: existingWPBioTemplateName,
				existingShortDescription: shortDescription
			} );
		} );
	}

	function showDeclineOptions() {
		loadView( 'decline', {}, () => {
			let $reasons, $commonSection, declineCounts,
				pristineState = $afch.find( '#declineInputWrapper' ).html();

			// pos is either 1 or 2, based on whether the chosen reason that
			// is triggering this update is first or second in the multi-select
			// control
			function updateTextfield( newPrompt, newPlaceholder, newValue, pos ) {
				const $wrapper = $afch.find( '#textfieldWrapper' + ( pos === 2 ? '2' : '' ) );

				// Update label and placeholder
				$wrapper.find( 'label' ).text( newPrompt );
				$wrapper.find( 'input' ).attr( 'placeholder', newPlaceholder );

				// Update default textfield value (perhaps)
				if ( typeof newValue !== 'undefined' ) {
					$wrapper.find( 'input' ).val( newValue );
				}

				// And finally show the textfield
				$wrapper.removeClass( 'hidden' );
			}

			// Copy most-used options to top of decline dropdown

			declineCounts = AFCH.userData.get( 'decline-counts', false );

			if ( declineCounts ) {
				const declineList = $.map( declineCounts, ( _, key ) => key );

				// Sort list in descending order (most-used at beginning)
				declineList.sort( ( a, b ) => declineCounts[ b ] - declineCounts[ a ] );

				$reasons = $afch.find( '#declineReason' );
				$commonSection = $( '<optgroup>' )
					.attr( 'label', 'ใช้บ่อย' )
					.insertBefore( $reasons.find( 'optgroup' ).first() );

				// Show the 5 most used options
				$.each( declineList.splice( 0, 5 ), ( _, rationale ) => {
					const $relevant = $reasons.find( 'option[value="' + rationale + '"]' );
					$relevant.clone( true ).appendTo( $commonSection );
				} );
			}

			// Set up jquery.chosen for the decline reason
			$afch.find( '#declineReason' ).chosen( {
				placeholder_text_single: 'เลือกเหตุผลที่ตีกลับที่นี่...',
				no_results_text: 'ไม่พบเหตุผลที่ตรงกับที่คุณค้นหา พิมพ์ "custom" เพื่อระบุเหตุผลด้วยตัวเอง',
				search_contains: true,
				inherit_select_classes: true,
				max_selected_options: 2
			} );

			// Set up jquery.chosen for the reject reason
			$afch.find( '#rejectReason' ).chosen( {
				placeholder_text_single: 'กรุณาเลือกเหตุผลที่ปัดตก...',
				search_contains: true,
				inherit_select_classes: true,
				max_selected_options: 2
			} );

			// rejectReason starts off hidden by default, which makes the _chosen div
			// display at 0px wide for some reason. We must manually fix this.
			$afch.find( '#rejectReason_chosen' ).css( 'width', '350px' );

			// And now add the handlers for when a specific decline reason is selected
			$afch.find( '#declineReason' ).on( 'change', () => {
				const reason = $afch.find( '#declineReason' ).val(),
					candidateDupeName = ( afchSubmission.shortTitle !== 'sandbox' ) ? afchSubmission.shortTitle : '',
					prevDeclineComment = $afch.find( '#declineTextarea' ).val(),
					declineHandlers = {
						cv: function () {
							$afch.find( '#cvUrlWrapper' ).removeClass( 'hidden' );
							$afch.add( '#csdWrapper' ).removeClass( 'hidden' );

							$afch.find( '#cvUrlTextarea' ).on( 'keyup', function () {
								let text = $( this ).val(),
									numUrls = text ? text.split( '\n' ).length : 0,
									$submitButton = $afch.find( '#afchSubmitForm' );
								if ( numUrls >= 1 && numUrls <= 3 ) {
									$( this ).removeClass( 'bad-input' );
									$submitButton
										.removeClass( 'disabled' )
										.css( 'pointer-events', 'auto' )
										.text( 'ตีกลับฉบับร่าง' );
								} else {
									$( this ).addClass( 'bad-input' );
									$submitButton
										.addClass( 'disabled' )
										.css( 'pointer-events', 'none' )
										.text( 'กรุณาใส่หนึ่งถึงสามลิงก์' );
								}
							} );

							// Check if there's an OTRS notice
							new AFCH.Page( 'คุยเรื่องฉบับร่าง:' + afchSubmission.shortTitle ).getText( /* usecache */ false ).done( ( text ) => {
								if ( /ConfirmationOTRS/.test( text ) ) {
									$afch.find( '#declineInputWrapper' ).append(
										$( '<div>' )
											.addClass( 'warnings' )
											.css( {
												'max-width': '50%',
												margin: '0px auto'
											} )
											.text( 'This draft has an OTRS template on the talk page. Verify that the copyright violation isn\'t covered by the template before marking this draft as a copyright violation.' ) );
								}
							} );
						},

						dup: function ( pos ) {
							updateTextfield( 'ชื่อของฉบับร่างที่ซ้ำ (ไม่ต้องใส่เนมสเปซ)', 'Articles for creation/Fudge', candidateDupeName, pos );
						},

						mergeto: function ( pos ) {
							updateTextfield( 'ชื่อบทความที่ฉบับร่างนี้ควรรวมเข้าไป', 'ชีสเบอร์เกอร์', candidateDupeName, pos );
						},

						lang: function ( pos ) {
							updateTextfield( 'ชื่อภาษาที่ฉบับร่างนี้ใช้ถ้าทราบ', 'เยอรมัน', '', pos );
						},

						exists: function ( pos ) {
							updateTextfield( 'ชื่อของบทความที่มีอยู่แล้ว', 'ผัดไทย', candidateDupeName, pos );
						},

						plot: function ( pos ) {
							updateTextfield( 'ชื่อของบทความที่เกี่ยวข้อง ถ้ามี', 'ชาร์ลี กับ โรงงานช็อกโกแลต', candidateDupeName, pos );
						},

						// Custom decline rationale
						reason: function () {
							$afch.find( '#declineTextarea' )
								.attr( 'placeholder', 'ใส่เหตุผลที่ตีกลับของคุณที่นี่โดยใช้โค้ดวิกิ' );
						}
					};

				// Reset to a pristine state :)
				$afch.find( '#declineInputWrapper' ).html( pristineState );

				// If there are special options to be displayed for each
				// particular decline reason, load them now
				if ( declineHandlers[ reason[ 0 ] ] ) {
					declineHandlers[ reason[ 0 ] ]( 1 );
				}
				if ( declineHandlers[ reason[ 1 ] ] ) {
					declineHandlers[ reason[ 1 ] ]( 2 );
				}

				// Preserve the custom comment text
				$afch.find( '#declineTextarea' ).val( prevDeclineComment );

				// If the user wants a preview, show it
				if ( $( '#previewTrigger' ).text() == '(ซ่อนตัวอย่าง)' ) {
					$( '#previewContainer' )
						.empty()
						.append( $.createSpinner( {
							size: 'large',
							type: 'block'
						} ).css( 'padding', '20px' ) );
					AFCH.getReason( reason ).done( ( html ) => {
						$( '#previewContainer' ).html( html );
					} );
				}

				// If a reason has been specified, show the textarea, notify
				// option, and the submit form button
				$afch.find( '#declineTextarea' ).add( '#notifyWrapper' ).add( '#afchSubmitForm' )
					.toggleClass( 'hidden', !reason || !reason.length )
					.on( 'keyup', mw.util.debounce( 500, () => {
						previewComment( $( '#declineTextarea' ), $( '#declineInputPreview' ) );
					} ) );
			} ); // End change handler for the decline reason select box

			// And the the handlers for when a specific REJECT reason is selected
			$afch.find( '#rejectReason' ).on( 'change', () => {
				const reason = $afch.find( '#rejectReason' ).val();

				// If a reason has been specified, show the textarea, notify
				// option, and the submit form button
				$afch.find( '#rejectTextarea' ).add( '#notifyWrapper' ).add( '#afchSubmitForm' )
					.toggleClass( 'hidden', !reason || !reason.length )
					.on( 'keyup', mw.util.debounce( 500, () => {
						previewComment( $( '#rejectTextarea' ), $( '#rejectInputPreview' ) );
					} ) );
			} ); // End change handler for the reject reason select box

			// Attach the preview event listener
			$afch.find( '#previewTrigger' ).on( 'click', function () {
				const reason = $afch.find( '#declineReason' ).val();
				if ( this.textContent == '(แสดงตัวอย่าง)' && reason ) {
					$( '#previewContainer' )
						.empty()
						.append( $.createSpinner( {
							size: 'large',
							type: 'block'
						} ).css( 'padding', '20px' ) );
					const reasonDeferreds = reason.map( AFCH.getReason );
					$.when.apply( $, reasonDeferreds ).then( function () {
						$( '#previewContainer' )
							.html( Array.prototype.slice.call( arguments )
								.join( '<hr />' ) );
					} );
					this.textContent = '(ซ่อนตัวอย่าง)';
				} else {
					$( '#previewContainer' ).empty();
					this.textContent = '(แสดงตัวอย่าง)';
				}
			} );

			// Attach the decline vs reject radio button listener
			$afch.find( 'input[type=radio][name=declineReject]' ).on( 'click', () => {
				const declineOrReject = $afch.find( 'input[name=declineReject]:checked' ).val();
				$afch.find( '#declineReasonWrapper' ).toggleClass( 'hidden', declineOrReject === 'reject' );
				$afch.find( '#rejectReasonWrapper' ).toggleClass( 'hidden', declineOrReject === 'decline' );
				$afch.find( '#declineInputWrapper' ).toggleClass( 'hidden', declineOrReject === 'reject' );
				$afch.find( '#rejectInputWrapper' ).toggleClass( 'hidden', declineOrReject === 'decline' );
			} );
		} ); // End loadView callback

		addFormSubmitHandler( handleDecline );
	}

	function addSignature( text ) {
		text = text.trim();
		if ( text.indexOf( '~~~~' ) === -1 ) {
			text += ' ~~~~';
		}
		return text;
	}

	function previewComment( $textarea, $previewArea ) {
		const commentText = $textarea.val();
		if ( commentText ) {
			AFCH.api.parse( '{{AfC comment|1=' + addSignature( commentText ) + '}}', {
				pst: true,
				title: mw.config.get( 'wgPageName' )
			} ).then( ( html ) => {
				$previewArea.html( html );
			} );
		} else {
			$previewArea.html( '' );
		}
	}

	function checkIfUserIsBlocked( userName ) {
		return AFCH.api.get( {
			action: 'query',
			list: 'blocks',
			bkusers: userName
		} ).then( ( data ) => {
			const blocks = data.query.blocks;
			let blockData = null;
			const currentTime = new Date().toISOString();

			for ( let i = 0; i < blocks.length; i++ ) {
				if ( blocks[ i ].expiry === 'infinity' || blocks[ i ].expiry > currentTime ) {
					blockData = blocks[ i ];
					break;
				}
			}

			return blockData;
		} ).catch( ( err ) => {
			console.log( 'abort ' + err );
			return null;
		} );
	}

	function showCommentOptions() {
		loadView( 'comment', {} );

		const $submitButton = $( '#afchSubmitForm' );
		$submitButton.hide();

		$( '#commentText' ).on( 'keyup', mw.util.debounce( 500, () => {
			previewComment( $( '#commentText' ), $( '#commentPreview' ) );

			// Hide the submit button if there is no comment typed in
			const comment = $( '#commentText' ).val();
			if ( comment.length > 0 ) {
				$submitButton.show();
			} else {
				$submitButton.hide();
			}
		} ) );

		addFormSubmitHandler( handleComment );
	}

	function showSubmitOptions() {
		const customSubmitters = [];

		// Iterate over the submitters and add them to the custom submitters list,
		// displayed in the "submit as" dropdown.
		$.each( afchSubmission.submitters, ( index, submitter ) => {
			customSubmitters.push( {
				name: submitter,
				description: submitter + ( index === 0 ? ' (ผู้ส่งคนล่าสุด)' : ' (ผู้ส่งในอดีต)' ),
				selected: index === 0
			} );
		} );

		loadView( 'submit', {
			customSubmitters: customSubmitters
		}, () => {

			// Reset the status indicators for the username & errors
			function resetStatus() {
				$afch.find( '#submitterName' ).removeClass( 'bad-input' );
				$afch.find( '#submitterNameStatus' ).text( '' );
				$afch.find( '#afchSubmitForm' )
					.removeClass( 'disabled' )
					.css( 'pointer-events', 'auto' )
					.text( 'ส่งตรวจ' );
			}

			// Show the other textbox when `other` is selected in the menu
			$afch.find( '#submitType' ).on( 'change', () => {
				const isOtherSelected = $afch.find( '#submitType' ).val() === 'other';

				if ( isOtherSelected ) {
					$afch.find( '#submitterNameWrapper' ).removeClass( 'hidden' );
					$afch.find( '#submitterName' ).trigger( 'keyup' );
				} else {
					$afch.find( '#submitterNameWrapper' ).addClass( 'hidden' );
				}

				resetStatus();

				// Show an error if there's no such user
				$afch.find( '#submitterName' ).on( 'keyup', function () {
					const $field = $( this ),
						$status = $( '#submitterNameStatus' ),
						$submitButton = $afch.find( '#afchSubmitForm' ),
						submitter = $field.val();

					// Reset form
					resetStatus();

					// If there's no value, don't even try
					if ( !submitter || !isOtherSelected ) {
						return;
					}

					// Check if the user string starts with "User:", because Template:AFC submission dies horribly if it does
					if ( submitter.lastIndexOf( 'ผู้ใช้:', 0 ) === 0 ) {
						$field.addClass( 'bad-input' );
						$status.text( 'ลบ "ผู้ใช้:" ออกจากข้อความเริ่มต้น' );
						$submitButton
							.addClass( 'disabled' )
							.css( 'pointer-events', 'none' )
							.text( 'ชื่อผู้ใช้ไม่ถูกต้อง' );
						return;
					}

					// Check if there is such a user
					AFCH.api.get( {
						action: 'query',
						list: 'users',
						ususers: submitter
					} ).done( ( data ) => {
						if ( data.query.users[ 0 ].missing !== undefined ) {
							$field.addClass( 'bad-input' );
							$status.text( 'ไม่พบผู้ใช้ชื่อ "' + submitter + '"' );
							$submitButton
								.addClass( 'disabled' )
								.css( 'pointer-events', 'none' )
								.text( 'ไม่พบผู้ใช้' );
						}
					} );
				} );
			} );
		} );

		addFormSubmitHandler( handleSubmit );
	}

	function showPostponeG13Options() {
		loadView( 'postpone-g13', {} );
		addFormSubmitHandler( handlePostponeG13 );
	}

	// These functions perform a given action using data passed in the `data` parameter.

	function handleAcceptOverRedirect( destinationPageTitle ) {
		// get rid of the accept form. replace it with the status div.
		prepareForProcessing();

		// Add {{Db-afc-move}} speedy deletion tag to redirect, and add to watchlist
		// THWIKI - we use the all purpose [[แม่แบบ:ลบ]] template
		( new AFCH.Page( destinationPageTitle ) ).edit( {
			contents: '{{ลบ|[[WP:ท4|ท4: การลบทางเทคนิค]]: เตรียมหน้าปลายทางการย้ายสำหรับ [[' + afchPage.rawTitle + ']] ผู้ดูแลระบบสามารถลบหน้านี้ได้โดยไม่ต้องตรวจฉบับร่างซ้ำ}}\n\n',
			mode: 'prependtext',
			summary: 'แจ้งลบทันทีสำหรับเตรียมย้ายหน้าฉบับร่างที่ยอมรับแล้ว ([[WP:ท4|ท4]])',
			statusText: 'กำลังแจ้งลบหน้า',
			watchlist: 'watch'
		} );

		// Mark the draft as under review.
		afchPage.getText( false ).then( ( rawText ) => {
			const text = new AFCH.Text( rawText );
			afchSubmission.setStatus( 'r', {
				reviewer: AFCH.consts.user,
				reviewts: '{{subst:REVISIONTIMESTAMP}}'
			} );
			text.updateAfcTemplates( afchSubmission.makeWikicode() );
			text.cleanUp();
			afchPage.edit( {
				contents: text.get(),
				summary: 'ทำเครื่องหมายหน้าว่ากำลังตรวจ',
				statusText: 'กำลังทำเครื่องหมายหน้าว่ากำลังตรวจ'
			} );
		} );
	}

	function handleAccept( data ) {
		let newText = data.afchText;

		AFCH.actions.movePage( afchPage.rawTitle, data.newTitle,
			'เผยแพร่ฉบับร่าง[[วิกิพีเดีย:ว่าที่บทความ|ว่าที่บทความ]]ที่ได้รับการยอมรับแล้ว',
			{ movetalk: true } ) // Also move associated talk page if exists (e.g. `Draft_talk:`)
			.done( ( moveData ) => {
				let $patrolLink,
					newPage = new AFCH.Page( moveData.to ),
					talkPage = newPage.getTalkPage(),
					recentPage = new AFCH.Page( 'วิกิพีเดีย:ว่าที่บทความ/ล่าสุด' );

				// ARTICLE
				// -------

				// get comments left by reviewers to put on talk page
				let comments = [];
				if ( data.copyComments ) {
					comments = newText.getAfcComments();
				}

				newText.removeAfcTemplates();

				newText.updateCategories( data.newCategories );

				// THWIKI - none for now
				// newText.updateShortDescription( data.existingShortDescription, data.shortDescription );

				// Clean the page
				newText.cleanUp( /* isAccept */ true );

				// Add biography details
				if ( data.isBiography ) {
					let deathYear = 'LIVING';
					if ( data.lifeStatus === 'dead' ) {
						deathYear = data.deathYear || 'MISSING';
					} else if ( data.lifeStatus === 'unknown' ) {
						deathYear = 'UNKNOWN';
					}
					// {{subst:L}}, which generates DEFAULTSORT as well as
					// adds the appropriate birth/death year categories
					// thwiki already +543 for birth/death year
					newText.append( '\n{{subst:Lifetime' +
						'|1=' + data.birthYear +
						'|2=' + deathYear +
						'|3=' + data.subjectName + '}}'
					);

				}

				// Stub sorting
				// thwiki: fine to leave it here, no need to comment out
				newText = newText.get();
				if ( typeof window.StubSorter_create_edit === 'function' ) {
					newText = window.StubSorter_create_edit( newText, data[ 'stub-sorter-select' ] || [] ).text;
				}

				newPage.edit( {
					contents: newText,
					summary: 'เก็บกวาดฉบับร่าง[[วิกิพีเดีย:ว่าที่บทความ|ว่าที่บทความ]]ที่ได้รับการยอมรับแล้ว'
				} );

				// Patrol the new page if desired
				if ( data.patrolPage ) {
					$patrolLink = $afch.find( '.patrollink' );
					if ( $patrolLink.length ) {
						AFCH.actions.patrolRcid(
							mw.util.getParamValue( 'rcid', $patrolLink.find( 'a' ).attr( 'href' ) ),
							newPage.rawTitle // Include the title for a prettier log message
						);
					}
				}

				// TALK PAGE
				// ---------

				// not compatible with thwiki - yet
				talkPage.getText().done( ( talkText ) => {
					talkText = AFCH.addTalkPageBanners(
						talkText,
						data.newAssessment,
						afchPage.additionalData.revId,
						data.isBiography,
						data.newWikiProjects,
						data.lifeStatus,
						data.subjectName
					);

					const summary = 'ใส่ส่วนหัวโครงการวิกิ';

					if ( comments && comments.length > 0 ) {
						talkText = talkText.trim() + '\n\n== ความเห็นจากผู้ตรวจผ่าน AfC ==\n' + comments.join( '\n\n' );
					}

					talkPage.edit( {
						contents: talkText,
						summary: summary
					} );
				} );

				// NOTIFY SUBMITTER
				// ----------------

				if ( data.notifyUser ) {
					afchSubmission.getSubmitter().done( ( submitter ) => {
						AFCH.actions.notifyUser( submitter, {
							message: AFCH.msg.get( 'accepted-submission',
								{ $1: newPage, $2: data.newAssessment } ),
							summary: 'ยินดีด้วย ฉบับร่างของคุณได้ถูกสร้างเป็นบทความจริงแล้ว'
						} );
					} );
				}

				// AFC/RECENT
				// ----------

				$.when( recentPage.getText(), afchSubmission.getSubmitter() )
					.then( ( text, submitter ) => {
						let newRecentText = text,
							matches = text.match( /{{AfC contribution.*?}}\s*/gi ),
							newTemplate = '{{AfC contribution|' + data.newAssessment + '|' + newPage + '|' + submitter + '}}\n';

						// Remove the older entries (at bottom of the page) if necessary
						// to ensure we keep only 10 entries at any given point in time
						while ( matches.length >= 10 ) {
							newRecentText = newRecentText.replace( matches.pop(), '' );
						}

						newRecentText = newTemplate + newRecentText;

						recentPage.edit( {
							contents: newRecentText,
							summary: 'เพิ่มหน้า [[' + newPage + ']] ในรายการการสร้างล่าสุด',
							watchlist: 'nochange'
						} );
					} );

				// LOG TO USERSPACE
				// ----------

				afchSubmission.getSubmitter().done( ( submitter ) => {
					AFCH.actions.logAfc( {
						title: afchPage.rawTitle,
						actionType: 'ยอมรับ',
						submitter: submitter
					} );
				} );
			} );
	}

	function handleDecline( data ) {
		let declineCounts,
			isDecline = data.declineRejectWrapper === 'decline', // true=decline, false=reject
			text = data.afchText,
			declineReason = data.declineReason[ 0 ],
			declineReason2 = data.declineReason.length > 1 ? data.declineReason[ 1 ] : null,
			newParams = {
				decliner: AFCH.consts.user,
				declinets: '{{subst:REVISIONTIMESTAMP}}'
			};

		if ( isDecline ) {
			newParams[ '2' ] = declineReason;

			// If there's a second reason, add it to the params
			if ( declineReason2 ) {
				newParams.reason2 = declineReason2;
			}
		} else {
			newParams[ '2' ] = data.rejectReason[ 0 ];
			if ( data.rejectReason[ 1 ] ) {
				newParams.reason2 = data.rejectReason[ 1 ];
			}
		}

		// Update decline counts
		declineCounts = AFCH.userData.get( 'decline-counts', {} );

		declineCounts[ declineReason ] = ( declineCounts[ declineReason ] || 1 ) + 1;
		if ( declineReason2 ) {
			declineCounts[ declineReason2 ] = ( declineCounts[ declineReason2 ] || 1 ) + 1;
		}

		AFCH.userData.set( 'decline-counts', declineCounts );

		// If the first reason is a custom decline, we include the declineTextarea in the {{AFC submission}} template
		if ( declineReason === 'reason' ) {
			newParams[ '3' ] = data.declineTextarea;
		} else if ( declineReason2 === 'reason' ) {
			newParams.details2 = data.declineTextarea;
		} else if ( isDecline && data.declineTextarea ) {

			// But otherwise if addtional text has been entered we just add it as a new comment
			afchSubmission.addNewComment( data.declineTextarea );
		}

		// If a user has entered something in the declineTextfield (for example, a URL or an
		// associated page), pass that as the third parameter...
		if ( data.declineTextfield ) {
			newParams[ '3' ] = data.declineTextfield;
		}

		// ...and do the same with the second decline text field
		if ( data.declineTextfield2 ) {
			newParams.details2 = data.declineTextfield2;
		}

		// If we're rejecting, any text in the text area is a comment
		if ( !isDecline && data.rejectTextarea ) {
			afchSubmission.addNewComment( data.rejectTextarea );
		}

		// Copyright violations get {{db-g12}}'d as well
		if ( declineReason === 'cv' || declineReason2 === 'cv' ) {
			let cvUrls = data.cvUrlTextarea.split( '\n' ).slice( 0, 3 ),
				urlParam = '';

			// Build url param for db-g12 template
			urlParam = cvUrls[ 0 ];
			if ( cvUrls.length > 1 ) {
				urlParam += '|url2=' + cvUrls[ 1 ];
				if ( cvUrls.length > 2 ) {
					urlParam += '|url3=' + cvUrls[ 2 ];
				}
			}
			text.prepend( '{{copyvios|url=' + urlParam + ( afchPage.additionalData.revId ? '|oldid=' + afchPage.additionalData.revId : '' ) + '}}\n' );

			// Include the URLs in the decline template
			if ( declineReason === 'cv' ) {
				newParams[ '3' ] = cvUrls.join( ', ' );
			} else {
				newParams.details2 = cvUrls.join( ', ' );
			}
		}

		if ( !isDecline ) {
			newParams.reject = 'yes';
		}

		// Now update the submission status
		afchSubmission.setStatus( 'd', newParams );

		text.updateAfcTemplates( afchSubmission.makeWikicode() );
		text.cleanUp();

		// Build edit summary
		let editSummary = ( isDecline ? 'ตีกลับ' : 'ปัดตก' ) + 'ฉบับร่าง: ',
			lengthLimit = declineReason2 ? 120 : 180;
		if ( declineReason === 'reason' ) {

			// If this is a custom decline, use the text in the edit summary
			editSummary += data.declineTextarea.substring( 0, lengthLimit );

			// If we had to trunucate, indicate that
			if ( data.declineTextarea.length > lengthLimit ) {
				editSummary += '...';
			}
		} else {
			editSummary += isDecline ? data.declineReasonTexts[ 0 ] : data.rejectReasonTexts[ 0 ];
		}

		if ( declineReason2 ) {
			editSummary += ' และ ';
			if ( declineReason2 === 'reason' ) {
				editSummary += data.declineTextarea.substring( 0, lengthLimit );
				if ( data.declineTextarea.length > lengthLimit ) {
					editSummary += '...';
				}
			} else {
				editSummary += data.declineReasonTexts[ 1 ];
			}
		}

		afchPage.edit( {
			contents: text.get(),
			summary: editSummary
		} );

		if ( data.notifyUser ) {
			afchSubmission.getSubmitter().done( ( submitter ) => {
				const userTalk = new AFCH.Page( ( new mw.Title( submitter, 3 ) ).getPrefixedText() ),
					shouldTeahouse = data.inviteToTeahouse ? $.Deferred() : false;

				// Check categories on the page to ensure that if the user has already been
				// invited to the Teahouse, we don't invite them again.
				// NOTE thwiki did not have teahouse, this is not implemented yet
				// if ( data.inviteToTeahouse ) {
				// 	userTalk.getCategories( /* useApi */ true ).done( ( categories ) => {
				// 		let hasTeahouseCat = false,
				// 			teahouseCategories = [
				// 				'Category:Wikipedians who have received a Teahouse invitation',
				// 				'Category:Wikipedians who have received a Teahouse invitation through AfC'
				// 			];

				// 		$.each( categories, ( _, cat ) => {
				// 			if ( teahouseCategories.indexOf( cat ) !== -1 ) {
				// 				hasTeahouseCat = true;
				// 				return false;
				// 			}
				// 		} );

				// 		shouldTeahouse.resolve( !hasTeahouseCat );
				// 	} );
				// }

				$.when( shouldTeahouse ).then( ( teahouse ) => {
					let message;
					if ( isDecline ) {
						message = AFCH.msg.get( 'declined-submission', {
							$1: AFCH.consts.pagename,
							$2: afchSubmission.shortTitle,
							$3: ( declineReason === 'cv' || declineReason2 === 'cv' ) ?
								'yes' : 'no',
							$4: declineReason,
							$5: newParams[ '3' ] || '',
							$6: declineReason2 || '',
							$7: newParams.details2 || '',
							$8: ( declineReason === 'reason' || declineReason2 === 'reason' ) ?
								'' : data.declineTextarea
						} );
					} else {
						message = AFCH.msg.get( 'rejected-submission', {
							$1: AFCH.consts.pagename,
							$2: afchSubmission.shortTitle,
							$3: data.rejectReason[ 0 ],
							$4: '',
							$5: data.rejectReason[ 1 ] || '',
							$6: '',
							$7: data.rejectTextarea
						} );
					}

					if ( teahouse ) {
						message += '\n\n' + AFCH.msg.get( 'teahouse-invite' );
					}

					AFCH.actions.notifyUser( submitter, {
						message: message,
						summary: 'แจ้งเตือน: [[' + AFCH.consts.pagename + '|ฉบับร่าง AfC ที่คุณสร้างไว้]] ได้ถูก' + isDecline ? 'ตีกลับ' : 'ปัดตก' + 'แล้ว'
					} );
				} );
			} );
		}

		// Log AfC if enabled and CSD if necessary
		afchSubmission.getSubmitter().done( ( submitter ) => {
			AFCH.actions.logAfc( {
				title: afchPage.rawTitle,
				actionType: isDecline ? 'ตีกลับ' : 'ปัดตก',
				declineReason: declineReason,
				declineReason2: declineReason2,
				submitter: submitter
			} );

			if ( data.csdSubmission ) {
				AFCH.actions.logCSD( {
					title: afchPage.rawTitle,
					reason: declineReason === 'cv' ? '[[WP:G10]] ({{tl|copyvio}})' :
						'{{tl|ลบ}} ([[WP:AFC|ว่าที่บทความ]])',
					usersNotified: data.notifyUser ? [ submitter ] : []
				} );
			}
		} );
	}

	function checkForEditConflict() {
		// Get timestamp of the revision currently loaded in the browser
		return AFCH.api.get( {
			action: 'query',
			format: 'json',
			prop: 'revisions',
			revids: mw.config.get( 'wgCurRevisionId' ),
			formatversion: 2
		} ).then( ( data ) => {
			// convert timestamp format from 2024-05-03T09:40:20Z to 1714729221
			const currentRevisionTimestampTZ = data.query.pages[ 0 ].revisions[ 0 ].timestamp;
			let currentRevisionSeconds = ( new Date( currentRevisionTimestampTZ ).getTime() ) / 1000;

			// add one second. we don't want the current revision to be in our list of revisions
			currentRevisionSeconds++;

			// Then get all revisions since that timestamp
			return AFCH.api.get( {
				action: 'query',
				format: 'json',
				prop: 'revisions',
				titles: [ mw.config.get( 'wgPageName' ) ],
				formatversion: 2,
				rvstart: currentRevisionSeconds,
				rvdir: 'newer'
			} ).then( ( data ) => {
				const revisionsSinceTimestamp = data.query.pages[ 0 ].revisions;
				if ( revisionsSinceTimestamp && revisionsSinceTimestamp.length > 0 ) {
					return true;
				}
				return false;
			} );
		} );
	}

	function showEditConflictMessage() {
		$( '#afchSubmitForm' ).hide();

		// Putting this here instead of in tpl-submissions.html to reduce code duplication
		const editConflictHtml = 'Edit conflict! Your changes were not saved. Please check the <a id="afchHistoryLink" href="">page history</a>. To avoid overwriting the other person\'s edits, please refresh this page and start again.';
		$( '#afchEditConflict' ).html( editConflictHtml );

		const historyLink = new mw.Uri( mw.util.getUrl( mw.config.get( 'wgPageName' ), { action: 'history' } ) );
		$( '#afchHistoryLink' ).prop( 'href', historyLink );

		$( '#afchEditConflict' ).show();
	}

	function handleComment( data ) {
		const text = data.afchText;

		afchSubmission.addNewComment( data.commentText );
		text.updateAfcTemplates( afchSubmission.makeWikicode() );

		text.cleanUp();

		afchPage.edit( {
			contents: text.get(),
			summary: 'แสดงความเห็นในฉบับร่าง'
		} );

		if ( data.notifyUser ) {
			afchSubmission.getSubmitter().done( ( submitter ) => {
				AFCH.actions.notifyUser( submitter, {
					message: AFCH.msg.get( 'comment-on-submission',
						{ $1: AFCH.consts.pagename } ),
					summary: 'แจ้งเตือน: ฉันได้แสดงความเห็นไว้ที่[[' + AFCH.consts.pagename + '|ฉบับร่างของคุณ]]'
				} );
			} );
		}
	}

	function handleSubmit( data ) {
		const text = data.afchText,
			submitter = $.Deferred(),
			submitType = data.submitType;

		if ( submitType === 'other' ) {
			submitter.resolve( data.submitterName );
		} else if ( submitType === 'self' ) {
			submitter.resolve( AFCH.consts.user );
		} else if ( submitType === 'creator' ) {
			afchPage.getCreator().done( ( user ) => {
				submitter.resolve( user );
			} );
		} else {
			// Custom selected submitter
			submitter.resolve( data.submitType );
		}

		submitter.done( ( submitter ) => {
			afchSubmission.setStatus( '', { u: submitter } );

			text.updateAfcTemplates( afchSubmission.makeWikicode() );
			text.cleanUp();

			afchPage.edit( {
				contents: text.get(),
				summary: 'ส่งฉบับร่าง'
			} );

		} );

	}

	function handleCleanup() {
		prepareForProcessing( 'เก็บกวาด' );

		afchPage.getText( false ).done( ( rawText ) => {
			const text = new AFCH.Text( rawText );

			// Even though we didn't modify them, still update the templates,
			// because the order may have changed/been corrected
			text.updateAfcTemplates( afchSubmission.makeWikicode() );

			text.cleanUp();

			afchPage.edit( {
				contents: text.get(),
				minor: true,
				summary: 'เก็บกวาดฉบับร่าง'
			} );
		} );
	}

	function handleMark( unmark ) {
		const actionText = ( unmark ? 'เลิกทำเครื่องหมาย' : 'ทำเครื่องหมาย' );

		prepareForProcessing( actionText, 'mark' );

		afchPage.getText( false ).done( ( rawText ) => {
			const text = new AFCH.Text( rawText );

			if ( unmark ) {
				afchSubmission.setStatus( '', { reviewer: false, reviewts: false } );
			} else {
				afchSubmission.setStatus( 'r', {
					reviewer: AFCH.consts.user,
					reviewts: '{{subst:REVISIONTIMESTAMP}}'
				} );
			}

			text.updateAfcTemplates( afchSubmission.makeWikicode() );
			text.cleanUp();

			afchPage.edit( {
				contents: text.get(),
				summary: actionText + 'ว่ากำลังตรวจฉบับร่าง'
			} );
		} );
	}

	function handleG13() {
		// We start getting the creator now (for notification later) because ajax is
		// radical and handles simultaneous requests, but we don't let it delay tagging
		const gotCreator = afchPage.getCreator();

		// Update the display
		prepareForProcessing( 'ส่งคำขอ', 'g10' );

		// Get the page text and the last modified date (cached!) and tag the page
		$.when(
			afchPage.getText( false ),
			afchPage.getLastModifiedDate()
		).then( ( rawText, lastModified ) => {
			const text = new AFCH.Text( rawText );

			// Add the deletion tag and clean up for good measure
			text.prepend( '{{ลบ-ท10|ts=' + AFCH.dateToMwTimestamp( lastModified ) + '}}\n' );
			text.cleanUp();

			afchPage.edit( {
				contents: text.get(),
				summary: 'ทำเครื่องหมายฉบับร่าง[[WP:AFC|AfC]] +' +
					'สำหรับการลบทันทีในเงื่อนไข [[WP:ท10|ท10]]'
			} );

			// Now notify the page creator as well as any and all previous submitters
			$.when( gotCreator ).then( ( creator ) => {
				const usersToNotify = [ creator ];

				$.each( afchSubmission.submitters, ( _, submitter ) => {
					// Don't notify the same user multiple times
					if ( usersToNotify.indexOf( submitter ) === -1 ) {
						usersToNotify.push( submitter );
					}
				} );

				$.each( usersToNotify, ( _, user ) => {
					AFCH.actions.notifyUser( user, {
						message: AFCH.msg.get( 'g13-submission',
							{ $1: AFCH.consts.pagename } ),
						summary: 'แจ้งเตือน: การแจ้งลบในเงื่อนไข [[WP:ท10|ท10]] ของฉบับร่าง [[' + AFCH.consts.pagename + ']]'
					} );
				} );

				// And finally log the CSD nomination once all users have been notified
				AFCH.actions.logCSD( {
					title: afchPage.rawTitle,
					reason: '[[WP:G10]]: ฉบับร่างทำไม่ได้ทำต่อ',
					usersNotified: usersToNotify
				} );
			} );
		} );
	}

	function handlePostponeG13( data ) {
		let postponeCode,
			text = data.afchText,
			rawText = text.get(),
			postponeRegex = /\{\{AfC postpone G13\s*(?:\|\s*(\d*)\s*)?\}\}/ig;
		const match = postponeRegex.exec( rawText );

		// First add the postpone template
		if ( match ) {
			if ( match[ 1 ] !== undefined ) {
				postponeCode = '{{AfC postpone G13|' + ( parseInt( match[ 1 ] ) + 1 ) + '}}';
			} else {
				postponeCode = '{{AfC postpone G13|2}}';
			}
			rawText = rawText.replace( match[ 0 ], postponeCode );
		} else {
			rawText += '\n{{AfC postpone G13|1}}';
		}

		text.set( rawText );

		// Then add the comment if entered
		if ( data.commentText ) {
			afchSubmission.addNewComment( data.commentText );
			text.updateAfcTemplates( afchSubmission.makeWikicode() );
		}

		text.cleanUp();

		afchPage.edit( {
			contents: text.get(),
			summary: 'เลื่อนกระบวนการลบ [[WP:ท10|ท10]]'
		} );
	}

}( AFCH, jQuery, mediaWiki ) );
// </nowiki>
