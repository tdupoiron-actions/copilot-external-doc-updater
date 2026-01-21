/**
 * Constants used across the Copilot External Doc Updater.
 * Centralizes magic numbers and configuration values.
 */

/** Maximum number of files to display in tree listings */
const TREE_FILE_LIMIT = 50;

/** Maximum number of documentation files to fetch */
const DOC_FILES_LIMIT = 5;

/** Maximum length for changelog summary text */
const MAX_SUMMARY_LENGTH = 2000;

/** Maximum length for README content in doc update prompts */
const MAX_README_CONTENT_LENGTH = 8000;

/** Short commit SHA length */
const SHORT_SHA_LENGTH = 7;

module.exports = {
  TREE_FILE_LIMIT,
  DOC_FILES_LIMIT,
  MAX_SUMMARY_LENGTH,
  MAX_README_CONTENT_LENGTH,
  SHORT_SHA_LENGTH,
};
