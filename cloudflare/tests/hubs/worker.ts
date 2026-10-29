/**
 * The Worker the hub tests run against: just the two Durable Objects, built
 * from the production classes. The real entry (`custom-worker.ts`) imports
 * OpenNext's build output, which a test run does not have.
 */
export { ChatHub } from "../../chat-hub";
export { CallHub } from "../../call-hub";

const worker = {
  fetch: () => new Response("hub test worker"),
};

export default worker;
