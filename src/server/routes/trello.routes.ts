import express, { type NextFunction, type Request, type Response } from 'express';
import { getTrelloService } from '../services/trello.service.js';
import { asyncHandler, HttpError } from '../utils/errors.js';

export const trelloRouter = express.Router();

const BOARD_ID_RE = /^[a-zA-Z0-9]{8,32}$/;

trelloRouter.param('boardId', (_req: Request, _res: Response, next: NextFunction, value: string) => {
  if (!BOARD_ID_RE.test(value)) return next(new HttpError(400, 'Invalid board id', 'VALIDATION_ERROR'));
  next();
});

trelloRouter.get(
  '/boards',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await getTrelloService().getBoards());
  }),
);

trelloRouter.get(
  '/workspaces',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await getTrelloService().getWorkspaces());
  }),
);

trelloRouter.get(
  '/boards/:boardId',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getTrelloService().getBoard(req.params.boardId));
  }),
);

trelloRouter.get(
  '/boards/:boardId/lists',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getTrelloService().getLists(req.params.boardId));
  }),
);

trelloRouter.get(
  '/boards/:boardId/labels',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getTrelloService().getLabels(req.params.boardId));
  }),
);
