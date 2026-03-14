import { createPagesHandler } from "../../_lib/pages-handler.js";
import { POST } from "../../../api/admin/automation.mjs";

export const onRequestPost = createPagesHandler(POST);
