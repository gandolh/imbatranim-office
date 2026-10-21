// A worker cannot see the desktop's global: importing React here must fail the build.
import { version } from 'react'

postMessage(version)
