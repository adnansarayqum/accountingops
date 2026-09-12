/** A messaging failure with the HTTP status and short code the route should answer with. */
export class MessagingError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
