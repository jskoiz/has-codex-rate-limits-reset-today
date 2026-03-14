import { createPagesHandler } from "../../_lib/pages-handler.js";
import { POST } from "../../../api/automation/poll.mjs";

export const onRequestPost = createPagesHandler(POST);
