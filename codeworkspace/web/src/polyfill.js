// isomorphic-git expects a global Buffer. Must be imported before isomorphic-git.
import { Buffer } from 'buffer';

if (!globalThis.Buffer) globalThis.Buffer = Buffer;
