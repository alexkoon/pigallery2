describe('Share', () => {
  beforeEach(() => {
    cy.viewport(1200, 600);
    cy.visit('/');
    cy.get('.card-body');
    cy.get('.col-sm-12').contains('Login');
    /* ==== Generated with Cypress Studio ==== */
    cy.get('#username').type('admin');
    cy.get('#password').clear();
    cy.get('#password').type('admin');
    cy.intercept({
      method: 'Get',
      url: '/pgapi/gallery/content/',
    }).as('getContent');
    cy.get('.col-sm-12 > .btn').click();
  });
  it('Open password protected sharing', () => {
    cy.wait('@getContent');

    cy.get('button#shareButton').click();
    cy.get('input#share-password').type('secret', {force: true});
    cy.get('button#getShareButton').click();

    cy.get('input#shareLink').should('contain.value', 'http');
    cy.get('input#shareLink')
      .invoke('val')
      .then((link: string) => {
        cy.get('button.btn-close').click();
        cy.get('button#button-frame-menu').click();
        cy.get('#dropdown-frame-menu  ng-icon[name="ionLogOutOutline"]').click({scrollBehavior: false});

        cy.intercept({
          method: 'Get',
          url: '/pgapi/search/*',
        }, (req) => {
          // Remove caching headers to force a 200 OK response from the server
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
        }).as('getSharedContent');
        const url = new URL(link);
        const sk = url.pathname.split('/').pop();
        cy.visit('/shareLogin?sk=' + sk);
        cy.get('input#password').type('secret');
        cy.get('button#button-share-login').click();


        cy.get('app-gallery', { timeout: 15000 }).should('exist');

        cy.wait('@getSharedContent').then((interception) => {
          expect(interception.response.statusCode).to.eq(200);
          assert.isNotNull(interception.response.body, '1st API call has data');
          assert.isNull(interception.response.body?.error, '1st API call has no error.');
        });
      });

  });

  it('Open password protected sharing with logged in user', () => {
    cy.wait('@getContent');

    cy.get('button#shareButton').click();
    cy.get('input#share-password').type('secret', {force: true});
    cy.get('button#getShareButton').click();

    cy.get('input#shareLink').should('contain.value', 'http');
    cy.get('input#shareLink')
      .invoke('val')
      .then((link: string) => {

        cy.intercept({
          method: 'Get',
          url: '/pgapi/search/*',
        }, (req) => {
          // Remove caching headers to force a 200 OK response from the server
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
        }).as('getSharedContent');
         cy.visit(link);


        cy.get('.mb-0 > :nth-child(1) > .nav-link').contains('Gallery');

        cy.wait('@getSharedContent').then((interception) => {
          expect(interception.response.statusCode).to.eq(200);
          assert.isNotNull(interception.response.body, '1st API call has data');
          assert.isNull(interception.response.body?.error, '1st API call has no error.');
        });
      });

  });


  /**
   * BUG 1 — toLogin() deadlock: visiting a password-protected share URL directly
   * while not logged in shows a blank screen instead of the share login page.
   *
   * Root cause: navigation.service.ts toLogin() awaits firstValueFrom(currentSharing),
   * which never emits before authentication — so the redirect to /shareLogin never fires.
   *
   * This test FAILS with current code and should PASS after the fix.
   */
  it('Bug 1: visiting password-protected share URL directly shows login prompt, not blank screen', () => {
    cy.wait('@getContent');

    cy.get('button#shareButton').click();
    cy.get('input#share-password').type('secret', {force: true});
    cy.get('button#getShareButton').click();

    cy.get('input#shareLink').should('contain.value', 'http');
    cy.get('input#shareLink')
      .invoke('val')
      .then((link: string) => {
        cy.get('button.btn-close').click();
        cy.get('button#button-frame-menu').click();
        cy.get('#dropdown-frame-menu  ng-icon[name="ionLogOutOutline"]').click({scrollBehavior: false});

        const url = new URL(link);
        const sk = url.pathname.split('/').pop();

        // Visit the direct share URL (as a recipient would) — NOT /shareLogin explicitly.
        // This is what triggers the toLogin() deadlock in the current code.
        cy.visit('/share/' + sk);

        // Should be redirected to the share login page, not stuck on a blank screen.
        // With the bug: URL stays at /share/<key> and nothing renders.
        cy.url({timeout: 5000}).should('include', 'shareLogin');
        cy.get('input#password', {timeout: 5000}).should('be.visible');
      });
  });

  /**
   * BUG 2 — 401 infinite loop: after visiting a password-protected share while logged
   * out, repeated 401 responses cause error.interceptor → logout() → getSessionUser()
   * → 401 → logout() → … to cycle indefinitely.
   *
   * Root cause: authentication.service.ts logout() unconditionally calls getSessionUser()
   * when isSharing() is true, even when the user is already unauthenticated.
   *
   * This test FAILS with current code and should PASS after the fix.
   */
  it('Bug 2: visiting password-protected share URL does not cause a /user/me request loop', () => {
    cy.wait('@getContent');

    cy.get('button#shareButton').click();
    cy.get('input#share-password').type('secret', {force: true});
    cy.get('button#getShareButton').click();

    cy.get('input#shareLink').should('contain.value', 'http');
    cy.get('input#shareLink')
      .invoke('val')
      .then((link: string) => {
        cy.get('button.btn-close').click();
        cy.get('button#button-frame-menu').click();
        cy.get('#dropdown-frame-menu  ng-icon[name="ionLogOutOutline"]').click({scrollBehavior: false});

        const url = new URL(link);
        const sk = url.pathname.split('/').pop();

        let userMeCallCount = 0;
        cy.intercept('/pgapi/user/me*', (req) => {
          userMeCallCount++;
          req.continue();
        }).as('userMe');

        cy.visit('/share/' + sk);

        // Allow time for any potential loop to accumulate requests.
        // A healthy flow makes at most one or two /user/me calls.
        // The loop typically fires dozens of times per second.
        // eslint-disable-next-line cypress/no-unnecessary-waiting
        cy.wait(2000);

        cy.wrap(null).then(() => {
          // With the bug: userMeCallCount climbs into the dozens or hundreds.
          // After the fix: at most a handful of calls.
          expect(userMeCallCount).to.be.lessThan(5);
        });
      });
  });

  it('Open no password sharing', () => {
    cy.wait('@getContent');

    cy.get('button#shareButton').click();
    cy.get('button#getShareButton').click();

    cy.get('input#shareLink').should('contain.value', 'http');
    cy.get('input#shareLink')
      .invoke('val')
      .then((link: string) => {
        cy.get('button.btn-close').click();
        cy.get('button#button-frame-menu').click();
        cy.get('#dropdown-frame-menu  ng-icon[name="ionLogOutOutline"]').click({scrollBehavior: false});


        cy.intercept({
          method: 'Get',
          url: '/pgapi/search/*',
        }, (req) => {
          // Remove caching headers to force a 200 OK response from the server
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
        }).as('getSharedContent');
        const url = new URL(link);
        const sk = url.pathname.split('/').pop();
        cy.request({
          method: 'GET',
          url: '/pgapi/share/' + sk + '?sk=' + sk,
          failOnStatusCode: false
        }).then(() => {
          cy.visit(link);
        });

        cy.get('app-gallery', { timeout: 15000 }).should('exist');

        cy.wait('@getSharedContent').then((interception) => {
          expect(interception.response.statusCode).to.eq(200);
          assert.isNotNull(interception.response.body, '1st API call has data');
          assert.isNull(interception.response.body?.error, '1st API call has no error.');
        });
      });
  });
});
