import { createPagesHandler } from "../_lib/pages-handler.js";
import { GET } from "../../api/status.mjs";

export const onRequestGet = createPagesHandler(GET);
