import { createPagesHandler } from "../../_lib/pages-handler.js";
import { DELETE, POST } from "../../../api/admin/session.mjs";

export const onRequestDelete = createPagesHandler(DELETE);
export const onRequestPost = createPagesHandler(POST);
