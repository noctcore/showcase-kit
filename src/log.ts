let verbose = false;
let quiet = false;

export const log = {
  setVerbose(value: boolean): void {
    verbose = value;
  },
  setQuiet(value: boolean): void {
    quiet = value;
  },
  info(message: string): void {
    if (!quiet) console.log(message);
  },
  warn(message: string): void {
    console.warn(message);
  },
  error(message: string): void {
    console.error(message);
  },
  debug(message: string): void {
    if (verbose) console.log(message);
  },
};
