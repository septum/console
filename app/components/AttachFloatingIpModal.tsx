/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright Oxide Computer Company
 */

import { useForm } from 'react-hook-form'

import { useApiMutation, useApiQueryClient, type FloatingIp, type Instance } from '~/api'
import { ListboxField } from '~/components/form/fields/ListboxField'
import { HL } from '~/components/HL'
import { addToast } from '~/stores/toast'
import { Message } from '~/ui/lib/Message'
import { Slash } from '~/ui/lib/Slash'

import { ModalForm } from './form/ModalForm'

function FloatingIpLabel({ fip }: { fip: FloatingIp }) {
  return (
    <div className="text-secondary selected:text-accent-secondary">
      <div>{fip.name}</div>
      <div className="flex gap-0.5">
        <div>{fip.ip}</div>
        {fip.description && (
          <>
            <Slash />
            <div className="grow overflow-hidden overflow-ellipsis whitespace-pre text-left">
              {fip.description}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export const AttachFloatingIpModal = ({
  floatingIps,
  instance,
  onDismiss,
}: {
  floatingIps: Array<FloatingIp>
  instance: Instance
  onDismiss: () => void
}) => {
  const queryClient = useApiQueryClient()
  const floatingIpAttach = useApiMutation('floatingIpAttach', {
    onSuccess(floatingIp) {
      queryClient.invalidateQueries('floatingIpList')
      queryClient.invalidateQueries('instanceExternalIpList')
      addToast(<>IP <HL>{floatingIp.name}</HL> attached</>) // prettier-ignore
      onDismiss()
    },
    onError: (err) => {
      addToast({ title: 'Error', content: err.message, variant: 'error' })
    },
  })
  const form = useForm({ defaultValues: { floatingIp: '' } })
  const floatingIp = form.watch('floatingIp')

  return (
    <ModalForm
      form={form}
      onDismiss={onDismiss}
      submitLabel="Attach floating IP"
      submitError={floatingIpAttach.error}
      loading={floatingIpAttach.isPending}
      title="Attach floating IP"
      onSubmit={() =>
        floatingIpAttach.mutate({
          path: { floatingIp }, // note that this is an ID!
          body: { kind: 'instance', parent: instance.id },
        })
      }
      submitDisabled={!floatingIp}
    >
      <Message
        variant="info"
        content={`Instance ‘${instance.name}’ will be reachable at the selected IP address`}
      />
      <form>
        <ListboxField
          control={form.control}
          name="floatingIp"
          label="Floating IP"
          placeholder="Select a floating IP"
          items={floatingIps.map((ip) => ({
            value: ip.id,
            label: <FloatingIpLabel fip={ip} />,
            selectedLabel: ip.name,
          }))}
          required
        />
      </form>
    </ModalForm>
  )
}
