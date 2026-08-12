/**
 * pdf-parse's package root (index.js) runs debug code when it is not
 * require()d by another CJS module — importing it from ESM trips that branch
 * and reads a test PDF relative to CWD. The library entry itself is safe, so
 * the job imports 'pdf-parse/lib/pdf-parse.js' directly; @types/pdf-parse
 * only declares the root module, hence this re-export shim.
 */
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdfParse from 'pdf-parse';
  export default pdfParse;
}
