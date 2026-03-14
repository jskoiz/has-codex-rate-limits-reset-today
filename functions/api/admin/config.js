import { createPagesHandler } from "../../_lib/pages-handler.js";
import { GET, POST } from "../../../api/admin/config.mjs";

export const onRequestGet = createPagesHandler(GET);
export const onRequestPost = createPagesHandler(POST);
