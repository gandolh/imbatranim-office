// The kit, and a second module importing React, so the stand-ins land in a shared chunk.
import { Button, useSystem } from '@imbatranim/ui'
import { useState } from 'react'

export const kit = { Button, useSystem, useState }
