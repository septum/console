/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright Oxide Computer Company
 */

import { createColumnHelper, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useCallback, useId, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import * as R from 'remeda'

import {
  apiq,
  instanceCan,
  queryClient,
  useApiMutation,
  usePrefetchedQuery,
  type AffinityGroup,
  type AntiAffinityGroup,
} from '@oxide/api'
import { Affinity24Icon } from '@oxide/design-system/icons/react'

import { AffinityPolicyHeader } from '~/components/AffinityDocsPopover'
import { ComboboxField } from '~/components/form/fields/ComboboxField'
import { HL } from '~/components/HL'
import { antiAffinityGroupList } from '~/forms/affinity-util'
import { useInstanceSelector } from '~/hooks/use-params'
import { AffinityGroupPolicyBadge } from '~/pages/project/affinity/AffinityPage'
import { confirmAction } from '~/stores/confirm-action'
import { addToast } from '~/stores/toast'
import { makeLinkCell } from '~/table/cells/LinkCell'
import { useColsWithActions, type MenuAction } from '~/table/columns/action-col'
import { Columns } from '~/table/columns/common'
import { Table } from '~/table/Table'
import { Button } from '~/ui/lib/Button'
import { CardBlock } from '~/ui/lib/CardBlock'
import { toComboboxItems } from '~/ui/lib/Combobox'
import { EmptyMessage } from '~/ui/lib/EmptyMessage'
import { Modal } from '~/ui/lib/Modal'
import { TableEmptyBox } from '~/ui/lib/Table'
import { ALL_ISH } from '~/util/consts'
import { pb } from '~/util/path-builder'
import type * as PP from '~/util/path-params'

export const instanceAntiAffinityGroups = ({ project, instance }: PP.Instance) =>
  apiq('instanceAntiAffinityGroupList', {
    path: { instance },
    query: { project, limit: ALL_ISH },
  })

const colHelper = createColumnHelper<AffinityGroup | AntiAffinityGroup>()
const staticCols = [
  colHelper.accessor('description', Columns.description),
  colHelper.accessor('policy', {
    header: AffinityPolicyHeader,
    cell: (info) => <AffinityGroupPolicyBadge policy={info.getValue()} />,
  }),
]

export function AntiAffinityCard() {
  const instanceSelector = useInstanceSelector()
  const { project, instance } = instanceSelector

  const { data: memberGroups } = usePrefetchedQuery(
    instanceAntiAffinityGroups(instanceSelector)
  )
  const { data: allGroups } = usePrefetchedQuery(antiAffinityGroupList(instanceSelector))
  const { data: instanceData } = usePrefetchedQuery(
    apiq('instanceView', { path: { instance }, query: { project } })
  )

  const nonMemberGroups = useMemo(
    () => R.differenceWith(allGroups.items, memberGroups.items, (a, b) => a.id === b.id),
    [memberGroups, allGroups]
  )

  const { mutateAsync: removeMember } = useApiMutation(
    'antiAffinityGroupMemberInstanceDelete',
    {
      onSuccess(_data, variables) {
        addToast(
          <>
            Instance <b>{variables.path.instance}</b> removed from anti-affinity group{' '}
            <b>{variables.path.antiAffinityGroup}</b>
          </>
        )
        queryClient.invalidateEndpoint('instanceAntiAffinityGroupList')
        queryClient.invalidateEndpoint('antiAffinityGroupMemberList')
      },
    }
  )

  const makeActions = useCallback(
    (group: AffinityGroup | AntiAffinityGroup): MenuAction[] => [
      {
        label: 'Remove instance from group',
        onActivate() {
          confirmAction({
            actionType: 'danger',
            doAction: () =>
              removeMember({
                path: {
                  antiAffinityGroup: group.name,
                  instance,
                },
                query: { project },
              }),
            modalTitle: 'Remove instance from group',
            modalContent: (
              <p>
                Are you sure you want to remove instance <b>{instance}</b> from group{' '}
                <b>{group.name}</b>?
              </p>
            ),
            errorTitle: 'Error removing instance from group',
          })
        },
      },
    ],
    [instance, project, removeMember]
  )

  // has to be memoized to avoid extra renders on instance poll closing the menu
  const cols = useMemo(
    () => [
      colHelper.accessor('name', {
        cell: makeLinkCell((antiAffinityGroup) =>
          pb.antiAffinityGroup({ project, antiAffinityGroup })
        ),
      }),
      ...staticCols,
    ],
    [project]
  )

  const [isModalOpen, setIsModalOpen] = useState(false)

  const antiAffinityTable = useReactTable({
    columns: useColsWithActions(cols, makeActions, 'Copy group ID'),
    data: memberGroups.items,
    getCoreRowModel: getCoreRowModel(),
  })

  let disabledReason = undefined
  if (!instanceCan.addToAffinityGroup(instanceData)) {
    disabledReason =
      <>Only <HL>stopped</HL> instances can be added to a group</> // prettier-ignore
  } else if (allGroups.items.length === 0) {
    disabledReason = 'No groups found'
  } else if (nonMemberGroups.length === 0) {
    disabledReason = 'Instance is already in all groups'
  }

  return (
    <CardBlock>
      <CardBlock.Header title="Anti-affinity groups" titleId="anti-affinity-groups-label">
        <Button
          size="sm"
          disabled={!!disabledReason}
          disabledReason={disabledReason}
          onClick={() => setIsModalOpen(true)}
        >
          Add to group
        </Button>
      </CardBlock.Header>
      <CardBlock.Body>
        {memberGroups.items.length > 0 ? (
          <Table
            aria-labelledby="anti-affinity-groups-label"
            table={antiAffinityTable}
            className="table-inline"
          />
        ) : (
          <TableEmptyBox border={false}>
            <EmptyMessage
              icon={<Affinity24Icon />}
              title="No anti-affinity groups"
              body="This instance is not a member of any anti-affinity groups"
            />
          </TableEmptyBox>
        )}
      </CardBlock.Body>
      {isModalOpen && (
        <AddToGroupModal
          onDismiss={() => setIsModalOpen(false)}
          nonMemberGroups={nonMemberGroups}
        />
      )}
    </CardBlock>
  )
}

type ModalProps = {
  onDismiss: () => void
  nonMemberGroups: (AffinityGroup | AntiAffinityGroup)[]
}

export function AddToGroupModal({ onDismiss, nonMemberGroups }: ModalProps) {
  const { project, instance } = useInstanceSelector()

  const form = useForm({ defaultValues: { group: '' } })
  const formId = useId()

  const { mutateAsync: addMember } = useApiMutation('antiAffinityGroupMemberInstanceAdd', {
    onSuccess(_data, variables) {
      onDismiss()
      queryClient.invalidateEndpoint('antiAffinityGroupMemberList')
      queryClient.invalidateEndpoint('instanceAntiAffinityGroupList')
      addToast(
        <>
          Instance <HL>{instance}</HL> added to anti-affinity group{' '}
          <HL>{variables.path.antiAffinityGroup}</HL>
        </>
      )
    },
    onError(error) {
      addToast({
        title: 'Failed to add instance to group',
        content: error.message,
        variant: 'error',
      })
    },
  })

  const handleSubmit = form.handleSubmit(({ group }) => {
    addMember({
      path: { antiAffinityGroup: group, instance },
      query: { project },
    })
  })

  return (
    <Modal isOpen onDismiss={onDismiss} title="Add to anti-affinity group">
      <Modal.Body>
        <Modal.Section>
          <p className="mb-6">
            Select a group to add instance <HL>{instance}</HL> to.
          </p>
          <form id={formId} onSubmit={handleSubmit}>
            <ComboboxField
              label="Anti-affinity group"
              placeholder="Select a group"
              name="group"
              items={toComboboxItems(nonMemberGroups)}
              required
              control={form.control}
            />
          </form>
        </Modal.Section>
      </Modal.Body>
      <Modal.Footer onDismiss={onDismiss} formId={formId} actionText="Add to group" />
    </Modal>
  )
}
