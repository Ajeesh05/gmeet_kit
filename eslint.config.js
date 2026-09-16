import globals from 'globals'

export default [
  {
    ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**', 'docs/**']
  },
  {
    // Extension source: classic scripts (service worker, content scripts, popup).
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.serviceworker, ...globals.webextensions }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn',
      'prefer-const': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error'
    }
  },
  {
    // popup.html loads popup.js, designscript.js and saved-links.js as three
    // classic scripts, so they share one global scope at runtime even though
    // eslint analyses them separately. These are their top-level names.
    files: ['scripts/popup/*.js'],
    languageOptions: {
      globals: {
        PAGE_CONFIG: 'writable',
        PageNavigator: 'writable',
        addLink: 'writable',
        checkboxDivs: 'writable',
        checkboxWrappers: 'writable',
        copyToClipboard: 'writable',
        deleteLink: 'writable',
        editLink: 'writable',
        exctractMeetUrls: 'writable',
        fetchController: 'writable',
        fetchMeetingCount: 'writable',
        fetchMeetsForLater: 'writable',
        fetchNewMeets: 'writable',
        getRecentMeetings: 'writable',
        getTimeAgo: 'writable',
        homeButton: 'writable',
        links: 'writable',
        linksContainer: 'writable',
        meetForLaterContainer: 'writable',
        meetingId: 'writable',
        meetings: 'writable',
        newLinkName: 'writable',
        newLinkUrl: 'writable',
        openRecentMeetings: 'writable',
        openSidePanel: 'writable',
        recentMeetingsContainer: 'writable',
        renderLinks: 'writable',
        saveLink: 'writable',
        saveMeetForLater: 'writable',
        settingButton: 'writable',
        setupSidePanelButton: 'writable',
        target: 'writable'
      }
    }
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.mjs', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-var': 'error',
      'prefer-const': 'error'
    }
  }
]
