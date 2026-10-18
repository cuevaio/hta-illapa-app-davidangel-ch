// evlog/workers logs raw objects for Workers Logs to ingest; Node's console
// would print those through util.inspect, multi-line and truncated, so the
// Node bundles keep evlog's default JSON line per event.
export { initLogger as initWorkersLogger } from "evlog";
