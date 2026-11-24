import { healthEcho } from "@input-secretary/contracts";
import { bindOperation } from "../../shared/registry/bind-operation";
import { echo } from "../health/application/echo";

export const operations = [bindOperation(healthEcho, echo)];
